"""Managed vocabularies (holo types + rarities) CRUD + delete guards."""
import pytest
from fastapi import HTTPException

from app import models as M
from app.admin.router import (
    create_holo_type, delete_holo_type, list_holo_types, HoloTypeBody,
    create_rarity, patch_rarity, delete_rarity, list_rarities,
    RarityBody, PatchRarityBody,
)

from conftest import mk_card_type


async def test_holo_type_add_and_delete(db):
    await create_holo_type(HoloTypeBody(name="galaxy-holo"), _="x")
    names = [h["name"] for h in (await list_holo_types(_="x"))["holo_types"]]
    assert "galaxy-holo" in names
    await delete_holo_type("galaxy-holo", _="x")
    names = [h["name"] for h in (await list_holo_types(_="x"))["holo_types"]]
    assert "galaxy-holo" not in names


async def test_rarity_add_patch_delete(db):
    await create_rarity(RarityBody(name="SECRET", resell_price_cents=1000), _="x")
    await patch_rarity("SECRET", PatchRarityBody(resell_price_cents=2500), _="x")
    row = [r for r in (await list_rarities(_="x"))["rarities"] if r["name"] == "SECRET"][0]
    assert row["resell_price_cents"] == 2500
    await delete_rarity("SECRET", _="x")
    names = [r["name"] for r in (await list_rarities(_="x"))["rarities"]]
    assert "SECRET" not in names


async def test_delete_holo_type_in_use_rejected(db):
    await create_holo_type(HoloTypeBody(name="holo"), _="x")
    await create_rarity(RarityBody(name="COMMON", resell_price_cents=50), _="x")
    await mk_card_type(db, sku="USE-CT")  # type="holo", rarity="COMMON"
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await delete_holo_type("holo", _="x")
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        await delete_rarity("COMMON", _="x")
    assert e.value.status_code == 409


async def test_duplicate_rarity_rejected(db):
    await create_rarity(RarityBody(name="DUP"), _="x")
    with pytest.raises(HTTPException) as e:
        await create_rarity(RarityBody(name="DUP"), _="x")
    assert e.value.status_code == 409
