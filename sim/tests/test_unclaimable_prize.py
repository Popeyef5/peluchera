"""What happens when a ball falls but its prize can't be handed over.

This should be unreachable — a turn must not start while any loaded ball has an
unclaimable prize (see the turn-start precondition task). But "should be
unreachable" is not "is unreachable", and the way this failed was ugly enough to
be worth pinning down:

  - the ball physically fell, yet the DB put it back to LOADED (phantom
    inventory: a ball counted as in the machine while it sits in the prize bin,
    and awardable a second time);
  - and the player got "🎉 You won!", confetti, and an empty modal — the app
    threw a party while handing them nothing.

Both are fixed. These tests force the failure and hold that line.
"""
import pytest

from harness.config import BOOSTER_BALL

pytestmark = pytest.mark.asyncio


async def test_an_unclaimable_prize_does_not_celebrate_and_does_not_lose_the_ball(
    player, cabinet, world
):
    sku = world.ball_sku(BOOSTER_BALL)
    assert sku, "expected the booster ball to be bound to an opened booster"

    # The operator marks the set out of print while its balls are still loaded.
    world.set_sku_in_stock(sku, False)
    try:
        await cabinet.win_with(BOOSTER_BALL)

        await player.pay_crypto()
        await player.play_a_turn()

        # It is reported as a failure, NOT as a win.
        result = await player.wait_for("turn_result", timeout=60)
        assert result["won"] is False
        assert result["outcome"] == "prize_unavailable"
        assert not player.saw("player_win"), "never announce a win with no prize"

        # No prize was invented.
        assert world.wins(player.address) == []

        # ...and the ball is recorded as GRABBED. It fell down the chute; the DB
        # must not claim it's still in the machine just because the prize
        # lookup failed after the fact.
        assert world.ball(BOOSTER_BALL)["status"] == "GRABBED"
    finally:
        world.set_sku_in_stock(sku, True)
