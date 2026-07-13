"""The four chute verdicts, end to end.

The ESP reports exactly one verdict per arm, and it answers two questions at
once — did the player win, and is the chute still usable:

    outcome   ball_serial   won?   chute healthy?
    no_fall   null          no     yes   (ordinary loss)
    no_read   null          no     NO    (fell, tag unreadable)
    no_exit   SET           YES    NO    (read, then jammed)
    ok        SET           yes    yes

The interesting one is no_exit: the machine is jammed and the queue must stop,
but the tag WAS read — so the player still finds out what they won.
"""
import asyncio

import pytest

from harness.config import BOOSTER_BALL

pytestmark = pytest.mark.asyncio


async def test_a_loss_is_reported_not_inferred(player, cabinet, world):
    """no_fall reaches the player as a real signal.

    It used to be swallowed by the Pi, leaving the UI to guess a loss from a
    6s timer — while the chute is allowed 15s. A slow win therefore showed
    'better luck next time' and *then* popped the win modal.
    """
    await cabinet.always_lose()

    await player.pay_crypto()
    await player.play_a_turn()

    result = await player.wait_for("turn_result")
    assert result["won"] is False
    assert result["outcome"] == "no_fall"

    assert world.wins(player.address) == []
    # An ordinary loss leaves the machine perfectly healthy.
    assert not player.saw("cabinet_fault")


async def test_jam_after_read_still_tells_the_player_what_they_won(player, cabinet, world):
    """no_exit: chute jammed, but the tag was read — credit the prize anyway."""
    # exit_stuck runs the full fall + RFID-read sequence and only then fails to
    # clear the exit — so the tag IS read, it just never leaves the chute.
    await cabinet.next_ball(BOOSTER_BALL)
    await cabinet.exit_stuck()

    await player.pay_crypto()
    await player.play_a_turn()

    # The player still learns their prize, despite the jam.
    win = await player.wait_for("player_win")
    assert win is not None and win["win_id"], "a jam must not cost the player their prize"
    assert win["prize_kind"] == "BOOSTER_PAIR"

    wins = world.wins(player.address)
    assert len(wins) == 1 and wins[0]["status"] == "PENDING"
    assert world.entry_played(player.address)["win"] is True

    # And the cabinet is reported blocked.
    fault = await player.wait_for("cabinet_fault")
    assert fault["kind"] == "exit_timeout"


async def test_unreadable_tag_faults_and_awards_nothing(player, cabinet, world):
    """no_read: something fell but we can't say what — no prize, chute blocked."""
    await cabinet.rfid_fail()

    await player.pay_crypto()
    await player.play_a_turn()

    result = await player.wait_for("turn_result")
    assert result["won"] is False
    assert result["outcome"] == "no_read"

    # We must not invent a prize we couldn't identify.
    assert world.wins(player.address) == []

    fault = await player.wait_for("cabinet_fault")
    assert fault["kind"] == "rfid_failed"


async def test_a_blocked_chute_pauses_the_queue_until_cleared(player, players, cabinet, world):
    """A jammed chute must not be handed another ball.

    This is what the dead time is *for*: the next player waits until the chute
    is confirmed clear, rather than playing into a blocked machine.
    """
    await cabinet.rfid_fail()

    await player.pay_crypto()
    await player.play_a_turn()
    await player.wait_for("cabinet_fault")

    # A new player pays and queues — but must NOT get a turn while blocked.
    p2 = await players("p2")
    mark = p2.mark()
    assert (await p2.pay_crypto())["status"] == "ok"

    with pytest.raises(TimeoutError):
        await p2.wait_for("turn_start", timeout=12, since=mark)

    assert world.queue_entries(p2.address)[-1]["status"] == "queued"  # still waiting

    # Operator clears the chute -> the queue resumes and p2 finally plays.
    await cabinet.always_lose()
    await cabinet.clear_fault()

    await p2.wait_for("turn_start", timeout=45, since=mark)
    await p2.wait_for("turn_result", timeout=45)
    assert world.entry_played(p2.address)["status"] == "played"
