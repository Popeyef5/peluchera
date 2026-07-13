"""The money-critical path, end to end: pay -> queue -> play -> win -> settle -> withdraw.

Everything runs through the real production code paths. The only thing stubbed
is the cabinet itself (mock Pi), which is the actual hardware boundary.
"""
import pytest

from harness.config import BOOSTER_BALL, CARD_BALL

pytestmark = pytest.mark.asyncio


async def test_pay_enqueues_a_play(player, world):
    res = await player.pay_crypto()
    assert res["status"] == "ok", res
    assert res["position"] >= 1

    payments = world.payments(player.address)
    assert len(payments) == 1
    assert payments[0]["method"] == "CRYPTO"
    assert payments[0]["status"] == "CONFIRMED"
    assert payments[0]["amount_cents"] == 1000          # $10 ticket
    assert payments[0]["queue_entry_id"] is not None    # linked to the play it bought

    entries = world.queue_entries(player.address)
    assert len(entries) == 1
    assert entries[0]["status"] in ("queued", "active")


async def test_double_entry_is_rejected(player, world):
    assert (await player.pay_crypto())["status"] == "ok"
    second = await player.pay_crypto()
    assert second["status"] == "error"
    assert "already in queue" in second["error"]
    # And crucially: no second payment was taken.
    assert len(world.payments(player.address)) == 1


async def test_win_a_booster_and_resell_it(player, cabinet, world):
    await cabinet.win_with(BOOSTER_BALL)

    await player.pay_crypto()
    await player.play_a_turn()

    win = await player.wait_for("player_win")
    assert win is not None and win["win_id"], "no prize minted"
    assert win["prize_kind"] == "BOOSTER_PAIR"

    # DB: entry marked won, ball grabbed, win PENDING
    entry = world.entry_played(player.address)
    assert entry["win"] is True
    assert world.ball(BOOSTER_BALL)["status"] == "GRABBED"

    wins = world.wins(player.address)
    assert len(wins) == 1 and wins[0]["status"] == "PENDING"

    # Resell it -> credit lands in the ledger, balance follows
    res = await player.resell_booster(win["win_id"])
    assert res["status"] == "ok", res

    assert world.wins(player.address)[0]["status"] == "SETTLED_RESELL"
    credits = [l for l in world.ledger(player.address) if l["kind"] == "RESELL"]
    assert len(credits) == 1
    assert world.balance_cents(player.address) == credits[0]["amount_cents"]


async def test_win_a_card_and_keep_it(player, cabinet, world):
    await cabinet.win_with(CARD_BALL)

    await player.pay_crypto()
    await player.play_a_turn()
    win = await player.wait_for("player_win")
    assert win["prize_kind"] == "SINGLE_CARD"

    res = await player.keep_card(win["win_id"])
    assert res["status"] == "ok", res

    assert world.wins(player.address)[0]["status"] == "SETTLED_KEEP"
    owned = world.cards(player.address)
    assert len(owned) == 1 and owned[0]["status"] == "IN_COLLECTION"
    # Keeping a card is not a payout — balance must stay put.
    assert world.balance_cents(player.address) == 0


async def test_a_loss_mints_nothing(player, cabinet, world):
    await cabinet.always_lose()

    await player.pay_crypto()
    await player.play_a_turn()

    entry = world.entry_played(player.address)
    assert entry["win"] is False
    assert world.wins(player.address) == []
    assert world.balance_cents(player.address) == 0
    # The play was still paid for — a loss is not a refund.
    assert world.payments(player.address)[-1]["status"] == "CONFIRMED"


async def test_withdraw_pays_out_and_zeroes_the_balance(player, cabinet, world):
    await cabinet.win_with(BOOSTER_BALL)
    await player.pay_crypto()
    await player.play_a_turn()
    win = await player.wait_for("player_win")
    await player.resell_booster(win["win_id"])

    owed = world.balance_cents(player.address)
    assert owed > 0

    res = await player.withdraw()
    assert res["status"] == "ok", res
    assert res["data"]["withdrawn"] == owed / 100

    assert world.balance_cents(player.address) == 0
    debits = [l for l in world.ledger(player.address) if l["kind"] == "WITHDRAWAL"]
    assert len(debits) == 1
    assert debits[0]["amount_cents"] == owed
    assert debits[0]["withdrawal_tx_hash"]          # synthetic in bypass, but present


async def test_withdraw_with_no_balance_is_rejected(player, world):
    res = await player.withdraw()
    assert res["status"] == "error"
    assert "no funds" in res["error"]
    assert world.ledger(player.address) == []


async def test_queue_is_fifo(player, players, cabinet, world):
    await cabinet.always_lose()
    p2 = await players("p2")

    first = await player.pay_crypto()
    second = await p2.pay_crypto()

    assert first["position"] < second["position"], "queue must be first-come-first-served"
