#!/usr/bin/env python
"""Fill the dev world with lifelike data so you can actually look at the UI.

Runs the same harness the tests use — real players over Socket.IO, the real
cabinet via the mock Pi — so everything it creates got there through production
code paths. Nothing is inserted behind the app's back.

    ./.venv/bin/python populate.py                 # sensible defaults
    ./.venv/bin/python populate.py --players 8 --plays 3 --win-rate 0.5
    ./.venv/bin/python populate.py --keep          # add to the world, don't wipe it

Outcomes are *scripted* rather than random: every win permanently consumes a
ball, so the run picks real LOADED balls from the DB and drives exactly those
wins. That keeps it from asking the machine for prizes that no longer exist.

Wins are settled in a realistic mix — some left pending (so the inventory has
something to open), some opened, some resold, some kept — and a few players cash
out, so balances and withdrawal history look real too.

At the end it prints each player's address. To *become* one of them in the
browser (bypass mode mints its own guest address), paste this in the console and
reload:

    sessionStorage.setItem('garra:guest-address', '<address>')
"""
import argparse
import asyncio
import random

from harness.cabinet import Cabinet
from harness.player import VirtualPlayer
from harness.world import World

NAMES = ["ana", "bruno", "caro", "diego", "eli", "facu", "gabi", "hugo",
         "ines", "javi", "kari", "lucas"]


async def settle(player: VirtualPlayer, win: dict, rng: random.Random) -> str:
    """Do something believable with a prize. Leaving some PENDING matters —
    that's what the inventory screen is for."""
    kind = win["prize_kind"]
    roll = rng.random()

    if roll < 0.30:
        return "left pending"

    if kind == "BOOSTER_PAIR":
        if roll < 0.65:
            res = await player.open_booster(win["win_id"])
            return "opened booster" if res.get("status") == "ok" else f"open failed: {res.get('error')}"
        res = await player.resell_booster(win["win_id"])
        return "resold booster" if res.get("status") == "ok" else f"resell failed: {res.get('error')}"

    # SINGLE_CARD
    if roll < 0.70:
        res = await player.keep_card(win["win_id"])
        return "kept card" if res.get("status") == "ok" else f"keep failed: {res.get('error')}"
    res = await player.resell_card(win["win_id"])
    return "resold card" if res.get("status") == "ok" else f"resell failed: {res.get('error')}"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", type=int, default=6)
    ap.add_argument("--plays", type=int, default=2, help="plays per player")
    ap.add_argument("--win-rate", type=float, default=0.45)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--keep", action="store_true", help="don't wipe the world first")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    world = World()
    cabinet = Cabinet()

    await cabinet.clear_fault()
    await cabinet.chute_delay(0)
    if not args.keep:
        world.drain()
        world.reset()

    # --- script the outcomes against real inventory -------------------------
    balls = world.loaded_balls()
    rng.shuffle(balls)
    total_plays = args.players * args.plays
    want_wins = min(int(total_plays * args.win_rate), len(balls))

    plan = [balls.pop() for _ in range(want_wins)] + [None] * (total_plays - want_wins)
    rng.shuffle(plan)

    print(f"\n{total_plays} plays across {args.players} players — "
          f"{want_wins} wins scripted against {want_wins + len(balls)} loaded balls\n")

    players = [VirtualPlayer(name=NAMES[i % len(NAMES)]) for i in range(args.players)]
    for p in players:
        await p.connect()

    # The machine is a single queue, so plays are serial by nature.
    for i, ball in enumerate(plan):
        p = players[i % args.players]

        if ball:
            await cabinet.win_with(ball["serial"])
        else:
            await cabinet.always_lose()

        pay = await p.pay_crypto()
        if pay.get("status") != "ok":
            print(f"  {p.name:6s} could not pay: {pay.get('error')}")
            continue

        mark = p.mark()
        await p.play_a_turn()

        if ball:
            win = await p.wait_for("player_win", timeout=60, since=mark)
            note = await settle(p, win, rng) if win else "win event had no prize!"
            print(f"  {p.name:6s} won {ball['prize_kind']:12s} ({ball['serial']}) -> {note}")
        else:
            await p.wait_for("turn_result", timeout=60, since=mark)
            print(f"  {p.name:6s} lost")

    # --- a few cash-outs so withdrawal history isn't empty -------------------
    print()
    for p in players:
        if world.balance_cents(p.address) > 0 and rng.random() < 0.5:
            res = await p.withdraw()
            if res.get("status") == "ok":
                print(f"  {p.name:6s} withdrew ${res['data']['withdrawn']:.2f}")

    # --- summary ------------------------------------------------------------
    print("\n" + "=" * 78)
    print(f"{'player':8s} {'address':44s} {'balance':>9s} {'pending':>8s} {'cards':>6s}")
    print("-" * 78)
    for p in players:
        pending = [w for w in world.wins(p.address) if w["status"] == "PENDING"]
        cards = world.cards(p.address)
        print(f"{p.name:8s} {p.address:44s} "
              f"${world.balance_cents(p.address) / 100:>8.2f} {len(pending):>8d} {len(cards):>6d}")
    print("=" * 78)

    world.check_invariants()
    print("invariants hold.\n")

    print("To look at the site as one of these players (bypass mode mints its own")
    print("guest address), run this in the browser console and reload:\n")
    print(f"    sessionStorage.setItem('garra:guest-address', '{players[0].address}')\n")

    for p in players:
        await p.disconnect()
    await cabinet.aclose()


if __name__ == "__main__":
    asyncio.run(main())
