"""An idle machine must leave the database alone, so serverless Postgres can sleep.

And it must never forget a queued player while doing so: the whole scheme rests
on "the queue is empty" only being believed when nothing could have changed it.
"""
import secrets

import pytest

from app import models as M
from app import machine, schedulers
from app import state
from app.payments import confirm_payment, initiate_payment

from conftest import mk_round


@pytest.fixture(autouse=True)
def _reset_idle_state():
    state.queue_known_empty = False
    state.queue_generation = 0
    state.current_player = None
    yield
    state.queue_known_empty = False
    state.current_player = None


@pytest.fixture
def no_db(monkeypatch):
    """Fail the test if anything opens a database session."""
    def _boom(*a, **k):
        raise AssertionError("touched the database while idle")
    monkeypatch.setattr(state, "async_session", _boom)
    monkeypatch.setattr(schedulers, "async_session", _boom)


# ─── the generation guard ────────────────────────────────────────────────

def test_empty_is_believed_when_nothing_changed():
    gen = state.queue_generation
    state.note_queue_empty(gen)
    assert state.queue_known_empty


def test_a_payment_during_the_query_wins():
    # The reader saw zero, but a payment committed while its query was in flight.
    gen = state.queue_generation
    state.note_queue_grew()
    state.note_queue_empty(gen)
    assert not state.queue_known_empty


async def test_confirm_payment_wakes_the_scheduler(db):
    await mk_round(db)
    await db.commit()
    state.queue_known_empty = True
    before = state.queue_generation
    payment = await initiate_payment(db, "0xwake", M.PaymentMethod.COMP, 0)
    await confirm_payment(db, payment, secrets.token_bytes(32))
    assert not state.queue_known_empty
    assert state.queue_generation == before + 1


# ─── idle paths stay off the database ────────────────────────────────────

async def test_global_sync_needs_no_database_when_idle(no_db):
    state.queue_known_empty = True
    payload = await state.global_sync()
    assert payload["queue_length"] == 0


async def test_scheduler_tick_skips_everything_when_idle(no_db, monkeypatch):
    async def _no_fitness_check():
        raise AssertionError("ran the fitness check with nothing to start")
    monkeypatch.setattr(machine, "blocked", _no_fitness_check)

    async def _fast_sleep(_):
        return None
    monkeypatch.setattr(schedulers.asyncio, "sleep", _fast_sleep)

    state.queue_known_empty = True
    await schedulers._turn_scheduler_loop()   # must return without touching either


# ─── and learns it is idle from a real query ─────────────────────────────

async def test_global_sync_learns_the_queue_is_empty(db):
    await mk_round(db)
    await db.commit()
    assert not state.queue_known_empty
    await state.global_sync()
    assert state.queue_known_empty


async def test_global_sync_does_not_mark_a_populated_queue_empty(db):
    await mk_round(db)
    await db.commit()
    payment = await initiate_payment(db, "0xq", M.PaymentMethod.COMP, 0)
    await confirm_payment(db, payment, secrets.token_bytes(32))
    payload = await state.global_sync()
    assert payload["queue_length"] == 1
    assert not state.queue_known_empty
