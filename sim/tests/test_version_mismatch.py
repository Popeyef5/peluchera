"""A protocol-version mismatch pauses the queue until it's resolved.

The compatibility check rides the same "machine not fit to play" gate as a jammed
chute: if the Pi reports a Pi<->VPS protocol the VPS doesn't speak, no turn starts
(and the operator is alerted on Telegram, once and then periodically). Here we
drive it via the mock reporting a bogus version, then a matching one.
"""
import pytest

pytestmark = pytest.mark.asyncio

# Must match central/fastapi/app/versioning.py PI_VPS_PROTO.
GOOD = 1
BAD = 999


async def test_a_version_mismatch_pauses_the_queue_then_clears(player, cabinet, world):
    await cabinet.report_version(BAD)

    mark = player.mark()
    assert (await player.pay_crypto())["status"] == "ok"

    # The machine must not start a turn while the versions disagree.
    with pytest.raises(TimeoutError):
        await player.wait_for("turn_start", timeout=12, since=mark)
    assert world.queue_entries(player.address)[-1]["status"] == "queued"

    # A matching version report clears the fault; the queue resumes.
    await cabinet.report_version(GOOD)
    await cabinet.always_lose()
    await player.wait_for("turn_start", timeout=60, since=mark)
    await player.wait_for("turn_result", timeout=60)
    assert world.entry_played(player.address)["status"] == "played"
