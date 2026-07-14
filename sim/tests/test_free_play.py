"""Pre-monetization mode: everyone logs in for real, nobody pays.

The point is that ONLY the payment is skipped. The player has a real account, a
real inventory and a real payout address, and every step after the payment —
queue, turn, win, booster, resell — is the same production path a paying player
takes. Withdrawals are simulated: no USDC leaves the treasury for a play nobody
paid for.
"""
import pytest

from harness.config import BOOSTER_BALL

pytestmark = pytest.mark.asyncio


async def test_a_comped_play_is_free_and_otherwise_completely_normal(
    player, cabinet, world
):
    # The server tells the client at login — so monetization can be switched on
    # with a backend restart, no frontend rebuild.
    assert player.free_play is True

    await cabinet.win_with(BOOSTER_BALL)

    res = await player.pay_free()
    assert res["status"] == "ok", res
    assert res["position"] >= 1

    # Recorded as a comped play: never mistakable for revenue.
    payments = world.payments(player.address)
    assert len(payments) == 1
    assert payments[0]["method"] == "COMP"
    assert payments[0]["amount_cents"] == 0
    assert payments[0]["status"] == "CONFIRMED"
    assert payments[0]["queue_entry_id"] is not None

    # ...and from here on it's an ordinary play.
    await player.play_a_turn()
    win = await player.wait_for("player_win", timeout=60)
    assert win["prize_kind"] == "BOOSTER_PAIR"

    res = await player.resell_booster(win["win_id"])
    assert res["status"] == "ok", res
    owed = world.balance_cents(player.address)
    assert owed > 0

    # Withdrawal is simulated — the balance clears and history records it, but
    # no real USDC left the treasury.
    res = await player.withdraw()
    assert res["status"] == "ok", res
    assert world.balance_cents(player.address) == 0
    debits = [l for l in world.ledger(player.address) if l["kind"] == "WITHDRAWAL"]
    assert len(debits) == 1 and debits[0]["withdrawal_tx_hash"]


async def test_nobody_can_be_charged_while_plays_are_comped(player):
    """The card rail must refuse — taking money for something we're giving away."""
    res = await player.pay_card()
    assert res["status"] == "error"
    assert "disabled" in res["error"]
