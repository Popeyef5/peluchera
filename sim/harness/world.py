"""Black-box view of the database.

Deliberately raw SQL, not the app's ORM: the suite should assert on what is
actually in Postgres, not on what the app's mappers say is there. If the two
ever disagree, that's a bug we want to see.
"""
import time
from typing import Any, Dict, List, Optional

import psycopg

from .config import DB_DSN

CREDIT_KINDS = ("DEPOSIT", "RESELL", "AUTO_RESELL", "CARD_RESELL", "BET_REFUND")
DEBIT_KINDS = ("WITHDRAWAL", "BET_PLACED")


class World:
    def __init__(self, dsn: str = DB_DSN):
        self.dsn = dsn

    def _q(self, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                cur.execute(sql, params)
                if cur.description is None:
                    return []
                return cur.fetchall()

    def _one(self, sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        rows = self._q(sql, params)
        return rows[0] if rows else None

    # --- lookups --------------------------------------------------------
    def user(self, address: str) -> Optional[dict]:
        return self._one("SELECT * FROM user_account WHERE wallet_address = %s", (address,))

    def payments(self, address: str) -> List[dict]:
        return self._q(
            "SELECT * FROM payment WHERE address = %s ORDER BY created_at", (address,)
        )

    def queue_entries(self, address: str) -> List[dict]:
        return self._q("SELECT * FROM queue WHERE address = %s ORDER BY id", (address,))

    def wins(self, address: str) -> List[dict]:
        return self._q(
            """SELECT w.* FROM win w
               JOIN user_account u ON u.id = w.user_id
               WHERE u.wallet_address = %s ORDER BY w.created_at""",
            (address,),
        )

    def ledger(self, address: str) -> List[dict]:
        return self._q(
            """SELECT l.* FROM ledger_entry l
               JOIN user_account u ON u.id = l.user_id
               WHERE u.wallet_address = %s ORDER BY l.created_at""",
            (address,),
        )

    def cards(self, address: str) -> List[dict]:
        return self._q(
            """SELECT c.* FROM card c
               JOIN user_account u ON u.id = c.owner_user_id
               WHERE u.wallet_address = %s""",
            (address,),
        )

    def ball(self, serial: str) -> Optional[dict]:
        return self._one("SELECT * FROM ball WHERE serial = %s", (serial,))

    def ball_sku(self, serial: str) -> Optional[str]:
        row = self._one(
            """SELECT ob.sku FROM ball b
               JOIN opened_booster ob ON ob.id = b.opened_booster_id
               WHERE b.serial = %s""",
            (serial,),
        )
        return row["sku"] if row else None

    def set_sku_in_stock(self, sku: str, in_stock: bool) -> None:
        """Flip a sealed-pack SKU's availability — what an operator does when a
        set goes out of print."""
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE closed_booster_stock SET in_stock = %s WHERE sku = %s",
                    (in_stock, sku),
                )

    def loaded_balls(self) -> List[dict]:
        """Balls still in the machine. A win GRABs one permanently, so this is a
        hard ceiling on how many wins a populate run can produce."""
        return self._q(
            "SELECT serial, prize_kind FROM ball WHERE status = 'LOADED' ORDER BY serial"
        )

    def balance_cents(self, address: str) -> int:
        row = self._one(
            """SELECT COALESCE(SUM(CASE WHEN kind = ANY(%s) THEN amount_cents ELSE 0 END), 0)
                    - COALESCE(SUM(CASE WHEN kind = ANY(%s) THEN amount_cents ELSE 0 END), 0)
                      AS cents
               FROM ledger_entry l
               JOIN user_account u ON u.id = l.user_id
               WHERE u.wallet_address = %s""",
            (list(CREDIT_KINDS), list(DEBIT_KINDS), address),
        )
        return int(row["cents"]) if row else 0

    # --- waiting --------------------------------------------------------
    def wait_until(self, predicate, timeout: float = 20.0, what: str = "condition"):
        """Poll until `predicate(self)` returns truthy. The backend broadcasts
        some events around the same time it commits, so a DB read immediately
        after an event can legitimately race the write."""
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            last = predicate(self)
            if last:
                return last
            time.sleep(0.25)
        raise AssertionError(f"timed out after {timeout}s waiting for {what} (last={last!r})")

    def wait_idle(self, stable_for: float = 1.5, timeout: float = 40.0) -> None:
        """Wait until the machine is *stably* idle before a test starts.

        Call AFTER reset() (which wipes the queue). Then confirm the queue STAYS
        empty for `stable_for` seconds. This closes the isolation race that plain
        drain() missed: the backend's turn_end holds no entry 'active' while it's
        awaiting the chute verdict, so the scheduler can promote a stale queued
        entry (left by a no-play test) into a losing turn right as we reset. Any
        such in-flight turn's verdict also drains harmlessly (its key is gone)
        during this window.

        Requires the machine to be unpaused (faults cleared, stock restored) —
        otherwise a queued entry would never drain. The fixture does that first.
        """
        deadline = time.time() + timeout
        empty_since = None
        while time.time() < deadline:
            busy = self._q("SELECT 1 FROM queue WHERE status IN ('queued','active') LIMIT 1")
            if busy:
                empty_since = None
            elif empty_since is None:
                empty_since = time.time()
            elif time.time() - empty_since >= stable_for:
                return
            time.sleep(0.2)
        raise AssertionError("machine never settled idle (queue kept refilling)")

    def entry_played(self, address: str):
        """The player's latest queue entry, once the backend has recorded it as played."""
        return self.wait_until(
            lambda w: next(
                (e for e in reversed(w.queue_entries(address)) if e["status"] == "played"),
                None,
            ),
            what=f"a played queue entry for {address}",
        )

    # --- reset ----------------------------------------------------------
    def reset(self) -> None:
        """Return the world to 'freshly seeded': wipe all play/money rows and
        put the seeded inventory back in the pool.

        Deliberately NOT `TRUNCATE ... CASCADE` — card.owner_user_id references
        user_account, so cascading from user_account would delete the seeded
        cards themselves. Instead: release inventory, then delete the
        transactional rows in dependency order.
        """
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            with conn.cursor() as cur:
                # Release inventory (also clears the FKs into win/shipment).
                cur.execute("UPDATE card SET status='IN_POOL', owner_user_id=NULL, "
                            "acquired_at=NULL, shipment_id=NULL")
                cur.execute("UPDATE opened_booster SET status='AVAILABLE', "
                            "reserved_by_win_id=NULL")
                cur.execute("UPDATE ball SET status='LOADED', voided_at=NULL")
                # A ball with no prize bound to it can never be claimed, so the
                # machine (rightly) refuses to run with one loaded. Real dev DBs
                # accumulate these from manual testing — void them, which is what
                # an operator would do.
                cur.execute("""
                    UPDATE ball SET status='VOIDED', voided_at=now()
                    WHERE (prize_kind='BOOSTER_PAIR' AND opened_booster_id IS NULL)
                       OR (prize_kind='SINGLE_CARD'  AND prize_card_id     IS NULL)
                """)
                # Restock every SKU — a test that took one out of stock must not
                # leave the machine unfit (and therefore paused) for the next one.
                cur.execute("UPDATE closed_booster_stock SET in_stock = true")
                # Then the transactional rows, children first.
                for table in ("ledger_entry", "payment", "win", "shipment",
                              "withdrawal", "queue", "user_account"):
                    cur.execute(f"DELETE FROM {table}")

    # --- invariants -----------------------------------------------------
    def check_invariants(self) -> None:
        """Global truths that must hold after *any* sequence of events.

        These are where the real bugs surface — not the happy path.
        """
        problems: List[str] = []

        # 1. Every win traces back to a CONFIRMED payment for its queue entry.
        #    (A prize that nobody paid for = free money.)
        rows = self._q(
            """SELECT w.id FROM win w
               LEFT JOIN payment p ON p.queue_entry_id = w.queue_entry_id
                                   AND p.status = 'CONFIRMED'
               WHERE p.id IS NULL"""
        )
        if rows:
            problems.append(f"{len(rows)} win(s) with no CONFIRMED payment behind them")

        # 2. A payment funds at most one play (unique ref / one queue entry).
        rows = self._q(
            """SELECT queue_entry_id FROM payment
               WHERE queue_entry_id IS NOT NULL
               GROUP BY queue_entry_id HAVING count(*) > 1"""
        )
        if rows:
            problems.append(f"{len(rows)} queue entr(ies) funded by >1 payment")

        # 3. A tx hash / PaymentIntent is never reused (replay).
        rows = self._q(
            "SELECT ref FROM payment WHERE ref IS NOT NULL GROUP BY ref HAVING count(*) > 1"
        )
        if rows:
            problems.append(f"replayed payment ref(s): {[r['ref'] for r in rows]}")

        # 4. A ball is claimed by at most one win.
        rows = self._q(
            "SELECT ball_id FROM win GROUP BY ball_id HAVING count(*) > 1"
        )
        if rows:
            problems.append(f"{len(rows)} ball(s) claimed by more than one win")

        # 5. No inventory left RESERVED without a PENDING win holding it.
        rows = self._q(
            """SELECT ob.id FROM opened_booster ob
               LEFT JOIN win w ON w.id = ob.reserved_by_win_id AND w.status = 'PENDING'
               WHERE ob.status = 'RESERVED' AND w.id IS NULL"""
        )
        if rows:
            problems.append(f"{len(rows)} opened_booster(s) RESERVED with no PENDING win")

        # 6. Nobody has a negative balance (over-withdrawal / double-spend).
        rows = self._q(
            f"""SELECT u.wallet_address,
                   COALESCE(SUM(CASE WHEN l.kind = ANY(%s) THEN l.amount_cents ELSE 0 END), 0)
                 - COALESCE(SUM(CASE WHEN l.kind = ANY(%s) THEN l.amount_cents ELSE 0 END), 0) AS cents
                FROM ledger_entry l JOIN user_account u ON u.id = l.user_id
                GROUP BY u.wallet_address HAVING
                   COALESCE(SUM(CASE WHEN l.kind = ANY(%s) THEN l.amount_cents ELSE 0 END), 0)
                 - COALESCE(SUM(CASE WHEN l.kind = ANY(%s) THEN l.amount_cents ELSE 0 END), 0) < 0""",
            (list(CREDIT_KINDS), list(DEBIT_KINDS), list(CREDIT_KINDS), list(DEBIT_KINDS)),
        )
        if rows:
            problems.append(
                f"negative balance for: {[(r['wallet_address'], r['cents']) for r in rows]}"
            )

        # 7. Every WITHDRAWAL that settled has a tx hash.
        rows = self._q(
            "SELECT id FROM ledger_entry WHERE kind = 'WITHDRAWAL' AND withdrawal_tx_hash IS NULL"
        )
        if rows:
            problems.append(f"{len(rows)} WITHDRAWAL ledger row(s) with no tx hash")

        if problems:
            raise AssertionError("INVARIANT VIOLATION:\n  - " + "\n  - ".join(problems))
