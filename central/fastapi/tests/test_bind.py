"""Unified bind endpoint + bindable balls (admin router)."""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app import models as M
from app.admin.router import (
    bind_ball_unified, bindable_balls, BindV2Body,
)

from conftest import (
    seed_vocab, mk_opened, mk_closed, mk_card_type, mk_ball,
)


async def test_bind_all_three_kinds(db):
    await seed_vocab(db)
    ob = await mk_opened(db)
    cb = await mk_closed(db, sku="CB-BIND")
    ct = await mk_card_type(db, sku="CT-BIND")
    await db.commit()

    r1 = await bind_ball_unified(
        BindV2Body(serial="U-OB", kind="OPENED_BOOSTER", opened_booster_id=str(ob.id)), _="x")
    r2 = await bind_ball_unified(
        BindV2Body(serial="U-CB", kind="CLOSED_BOOSTER", closed_booster_sku="CB-BIND"), _="x")
    r3 = await bind_ball_unified(
        BindV2Body(serial="U-SC", kind="SINGLE_CARD", card_type_sku="CT-BIND"), _="x")
    assert r1["prize_kind"] == "OPENED_BOOSTER"
    assert r2["prize_kind"] == "CLOSED_BOOSTER"
    assert r3["prize_kind"] == "SINGLE_CARD"

    b = await db.scalar(select(M.Ball).where(M.Ball.serial == "U-CB"))
    assert b.closed_booster_id == cb.id
    assert b.status == M.BallStatus.LOADED


async def test_bind_opened_booster_already_loaded_rejected(db):
    await seed_vocab(db)
    ob = await mk_opened(db)
    await mk_ball(db, "HELD", M.PrizeKind.OPENED_BOOSTER, opened=ob)  # LOADED
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await bind_ball_unified(
            BindV2Body(serial="NEW", kind="OPENED_BOOSTER", opened_booster_id=str(ob.id)), _="x")
    assert e.value.status_code == 409


async def test_bind_closed_booster_out_of_stock_rejected(db):
    await seed_vocab(db)
    await mk_closed(db, sku="OOS-CB", in_stock=False)
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await bind_ball_unified(
            BindV2Body(serial="X", kind="CLOSED_BOOSTER", closed_booster_sku="OOS-CB"), _="x")
    assert e.value.status_code == 409


async def test_bind_incomplete_card_type_rejected(db):
    await seed_vocab(db)
    await mk_card_type(db, sku="INC-CT", complete=False)
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await bind_ball_unified(
            BindV2Body(serial="X", kind="SINGLE_CARD", card_type_sku="INC-CT"), _="x")
    assert e.value.status_code == 409


async def test_rebind_voided_ball(db):
    await seed_vocab(db)
    cb = await mk_closed(db, sku="RB-CB")
    await mk_ball(db, "RB", M.PrizeKind.CLOSED_BOOSTER, closed=cb, status=M.BallStatus.VOIDED)
    await db.commit()
    res = await bind_ball_unified(
        BindV2Body(serial="RB", kind="CLOSED_BOOSTER", closed_booster_sku="RB-CB"), _="x")
    assert res["created"] is False
    b = await db.scalar(select(M.Ball).where(M.Ball.serial == "RB"))
    assert b.status == M.BallStatus.LOADED


async def test_bindable_lists_only_non_loaded(db):
    await seed_vocab(db)
    cb = await mk_closed(db)
    await mk_ball(db, "LOADED1", M.PrizeKind.CLOSED_BOOSTER, closed=cb, status=M.BallStatus.LOADED)
    await mk_ball(db, "VOID1", M.PrizeKind.CLOSED_BOOSTER, status=M.BallStatus.VOIDED)
    await mk_ball(db, "GRAB1", M.PrizeKind.CLOSED_BOOSTER, status=M.BallStatus.GRABBED)
    await db.commit()
    res = await bindable_balls(_="x")
    serials = {b["serial"] for b in res["balls"]}
    assert "LOADED1" not in serials
    assert {"VOID1", "GRAB1"} <= serials
