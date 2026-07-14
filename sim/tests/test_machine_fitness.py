"""The machine must refuse to start a turn it cannot honour.

The precondition: every ball still in the machine has to be winnable. If one
isn't, a player could pay, physically win, and get nothing — so the queue pauses
until an operator voids or rebinds the offending ball.

This checks the STATE rather than guarding each mutation, so it catches every
route into the bad state. The test proves that by corrupting the world the way
nothing in the code would: straight into the database.
"""
import pytest

from harness.config import BOOSTER_BALL

pytestmark = pytest.mark.asyncio


async def test_an_unclaimable_ball_pauses_the_queue_until_it_is_fixed(
    player, cabinet, world
):
    sku = world.ball_sku(BOOSTER_BALL)
    assert sku

    # The set goes out of print while its balls are still loaded in the machine.
    world.set_sku_in_stock(sku, False)
    try:
        mark = player.mark()
        assert (await player.pay_crypto())["status"] == "ok"

        # The machine must NOT take this turn — the prize can't be handed over.
        with pytest.raises(TimeoutError):
            await player.wait_for("turn_start", timeout=12, since=mark)

        assert world.queue_entries(player.address)[-1]["status"] == "queued"
        # ...and the ball is still in the machine; nothing was dispensed.
        assert world.ball(BOOSTER_BALL)["status"] == "LOADED"

        # Operator restocks (or would void/rebind the ball) -> the queue resumes.
        world.set_sku_in_stock(sku, True)

        await cabinet.win_with(BOOSTER_BALL)
        # play_a_turn waits for turn_start itself — the machine has to come back
        # to life on its own now that every loaded ball is claimable again.
        await player.play_a_turn(timeout=90)

        win = await player.wait_for("player_win", timeout=60)
        assert win["win_id"], "once fit again, the machine pays out normally"
    finally:
        world.set_sku_in_stock(sku, True)
