"""Defence in depth: a prize that vanishes *mid-turn*.

The machine now refuses to start a turn while any loaded ball is unclaimable
(see test_machine_fitness), so the obvious route into this state is closed. What
that gate cannot prevent is a race: the turn passes the check, the player is
already playing, and only *then* does the prize go away.

That's the should-never-happen branch — and the way it used to fail was ugly
enough to be worth pinning:

  - the ball physically fell, yet the DB put it back to LOADED (phantom
    inventory: counted as still in the machine, and awardable again);
  - and the player got "🎉 You won!", confetti, and an empty modal — a party
    thrown while handing them nothing.

Both are fixed. This forces the race and holds that line.
"""
import pytest

from harness.config import BOOSTER_BALL

pytestmark = pytest.mark.asyncio


async def test_a_prize_lost_mid_turn_does_not_celebrate_and_does_not_lose_the_ball(
    player, cabinet, world
):
    sku = world.ball_sku(BOOSTER_BALL)
    assert sku

    await cabinet.win_with(BOOSTER_BALL)
    try:
        await player.pay_crypto()

        # The machine was fit when the turn started...
        await player.wait_for("turn_start", timeout=90)
        # ...and the set goes out of print WHILE they're playing. Too late to
        # refuse the turn; the ball is already on its way down.
        world.set_sku_in_stock(sku, False)

        await player.wait_for("turn_end", timeout=90)

        # Reported as the failure it is — never as a win.
        result = await player.wait_for("turn_result", timeout=60)
        assert result["won"] is False
        assert result["outcome"] == "prize_unavailable"
        assert not player.saw("player_win"), "never announce a win with no prize"

        # No prize was invented.
        assert world.wins(player.address) == []

        # ...and the ball is recorded as GRABBED. It fell down the chute; the DB
        # must not claim it's still in the machine just because the prize lookup
        # failed after the fact.
        assert world.ball(BOOSTER_BALL)["status"] == "GRABBED"
    finally:
        world.set_sku_in_stock(sku, True)
