"""Regression: a slow chute must not credit the prize to the next player.

The bug: the Pi broadcasts turn_end the moment the ball passes the opto and only
THEN arms the chute, so the verdict always lands after the turn ended. The
backend used to sleep a fixed INTER_TURN_DELAY (3s) and start the next turn
regardless — while the chute is allowed 15s. A slow ball or an RFID retry pushed
the verdict past the gap, and it was credited to `state.current_key`: whoever was
playing by then. The next player in the queue got the booster; the real winner
got nothing.

This test makes the chute slower than that old gap. It fails on the old code.
"""
import pytest

from harness.config import BOOSTER_BALL

pytestmark = pytest.mark.asyncio

SLOW = 6.0   # > the old fixed INTER_TURN_DELAY of 3s


async def test_a_slow_verdict_credits_the_player_who_actually_won(player, players, cabinet, world):
    p2 = await players("p2")

    await cabinet.win_with(BOOSTER_BALL)
    await cabinet.chute_delay(SLOW)
    try:
        # p1 plays and wins; p2 is queued right behind them.
        await player.pay_crypto()
        assert (await p2.pay_crypto())["status"] == "ok"

        await player.play_a_turn()

        # The prize belongs to p1 — the turn that fired the arm.
        win = await player.wait_for("player_win", timeout=60)
        assert win is not None and win["win_id"], "the actual winner got nothing"
        assert player.saw("player_win")

        # ...and must NOT have been handed to whoever came next.
        assert not p2.saw("player_win"), "prize was credited to the WRONG player"

        assert world.entry_played(player.address)["win"] is True
        p1_wins = world.wins(player.address)
        assert len(p1_wins) == 1
        assert world.wins(p2.address) == []
    finally:
        await cabinet.chute_delay(0)


async def test_the_next_turn_waits_for_the_chute(player, players, cabinet, world):
    """The dead time IS the chute sequence: p2 must not start until it reports."""
    p2 = await players("p2")

    await cabinet.always_lose()
    await cabinet.chute_delay(SLOW)
    try:
        await player.pay_crypto()
        assert (await p2.pay_crypto())["status"] == "ok"

        await player.play_a_turn()
        mark = p2.mark()

        # p1's outcome resolves first...
        result = await player.wait_for("turn_result", timeout=60)
        assert result["outcome"] == "no_fall"

        # ...and only then does p2 get the machine.
        await p2.wait_for("turn_start", timeout=60, since=mark)
    finally:
        await cabinet.chute_delay(0)
