import asyncio

import pytest
import pytest_asyncio

from harness.cabinet import Cabinet
from harness.player import VirtualPlayer
from harness.world import World


@pytest.fixture(scope="session")
def world() -> World:
    return World()


@pytest_asyncio.fixture(autouse=True)
async def fresh_world(request, world):
    # Static tests (e.g. protocol-version agreement) read source files only and
    # need no running stack — skip the cabinet/DB reset for them.
    if request.node.get_closest_marker("static"):
        yield
        return
    """Every test starts from a freshly-seeded world AND a healthy cabinet.

    Clearing the fault is not optional: a latched chute fault (rfid_failed /
    exit_timeout) makes every subsequent arm return 'still_blocked', so one stray
    fault silently breaks every test that follows.

    We also park the machine in always-lose: it's the only mode that neither
    latches faults nor consumes the next-tag override, so a stray turn left over
    from a previous test can't eat the ball the next test is waiting for.
    """
    c = Cabinet()
    # Park the machine FIRST, so any turn still running from the previous test
    # loses harmlessly: always-lose neither latches a fault nor consumes the
    # next-tag override the upcoming test is about to set.
    await c.always_lose()
    await c.chute_delay(0)     # a test that slowed the chute must not leak it
    await c.report_version(1)  # clear any version fault a prior test left set

    # Then actually WAIT for the fault to clear, don't just ask for it. The Pi
    # FSM only handles fault_clear when it's idle, so if the previous test left
    # it mid-turn the clear lands late — and the backend's cabinet_fault (which
    # pauses the queue) only clears on the esp_status that follows. Starting a
    # test against a stale fault makes it hang.
    for _ in range(60):
        await c.clear_fault()
        st = await c.state()
        if not st.get("fault_kind"):
            break
        await asyncio.sleep(0.25)
    else:
        raise AssertionError("cabinet fault would not clear — machine stuck")
    await c.aclose()

    # Wipe first — so the scheduler has no stale queued entry to promote into a
    # turn — then wait until the machine is *stably* idle. reset() also restores
    # inventory/stock, which lets the backend clear any inventory fault on its
    # next tick so wait_idle doesn't deadlock on a paused machine.
    world.reset()
    world.wait_idle()
    yield


@pytest_asyncio.fixture
async def cabinet():
    c = Cabinet()
    yield c
    # Leave the machine in a neutral state for the next test.
    await c.random(win_rate=0.5)
    await c.aclose()


@pytest_asyncio.fixture
async def player(world):
    """A connected virtual player. Invariants are checked on teardown, so every
    test enforces them whether it asks to or not."""
    p = VirtualPlayer(name="p1")
    await p.connect()
    yield p
    await p.disconnect()
    world.check_invariants()


@pytest_asyncio.fixture
async def players(world):
    """Factory for extra players (queue-ordering tests)."""
    made = []

    async def _make(name: str) -> VirtualPlayer:
        p = VirtualPlayer(name=name)
        await p.connect()
        made.append(p)
        return p

    yield _make
    await asyncio.gather(*(p.disconnect() for p in made))
    world.check_invariants()
