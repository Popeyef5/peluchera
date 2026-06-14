"""Socket.IO handlers for inventory and win settlement.

Each handler is a thin wrapper over a `win_transitions.py` function:
- pulls the wallet address from the SID-keyed session map,
- ensures the actor owns the row being acted on,
- runs the transition in a session/transaction,
- maps typed errors to {status: "error", error: "..."} acks.

Pricing for buybacks: win-resells use the price snapshotted on the Win row
at win time. Collection-card resells look up the price from
RESELL_PRICE_BY_RARITY_CENTS in config (placeholder).

Note on balance: the existing flow reads balance from the on-chain contract
via `user_account_data`. LedgerEntry rows written here are the off-chain
audit log; reflecting buyback credits *on chain* (so users can withdraw)
is a separate concern that lives in the buyback contract call, not here.
"""

import uuid
from typing import Optional
from datetime import datetime

from sqlalchemy import select

from .sio_instance import sio
from ..deps import async_session
from ..state import sid_to_addr
from ..logging import log
from ..config import RESELL_PRICE_BY_RARITY_CENTS
from ..models import (
	User, Win, Card, OpenedBooster, Shipment,
	WinStatus, CardStatus, PrizeKind,
)
from .. import win_transitions as wt


# ─── Helpers ────────────────────────────────────────────────────────────

def _err(msg: str, code: str = "error"):
	return {"status": "error", "error": msg, "code": code}


def _ok(**data):
	return {"status": "ok", **data}


async def _require_addr(sid) -> Optional[str]:
	addr = sid_to_addr.get(sid)
	if not addr:
		return None
	return addr


async def _user_for_sid(session, sid) -> Optional[User]:
	addr = sid_to_addr.get(sid)
	if not addr:
		return None
	return await wt.get_or_create_user(session, addr)


def _serialize_card(c: Card) -> dict:
	return {
		"id": str(c.id),
		"set": c.set,
		"number": c.number,
		"rarity": c.rarity.value if c.rarity else None,
		"image_url": c.image_url,
		"condition": c.condition,
		"status": c.status.value,
		"acquired_at": int(c.acquired_at.timestamp()) if c.acquired_at else None,
	}


def _serialize_pending_win(w: Win) -> dict:
	base = {
		"win_id": str(w.id),
		"prize_kind": w.prize_kind.value,
		"created_at": int(w.created_at.timestamp()),
		"expires_at": int(w.expires_at.timestamp()),
		"resell_price_cents": w.resell_price_cents,
		"ball_serial": w.ball.serial if w.ball else None,
	}
	if w.prize_kind == PrizeKind.BOOSTER_PAIR:
		# The sealed pack is fungible-by-SKU (ClosedBoosterStock); its SKU is
		# the opened booster's SKU, surfaced below.
		base["opened_booster"] = {
			"id": str(w.opened_booster.id),
			"sku": w.opened_booster.sku,
			"video_url": w.opened_booster.video_url,
			"video_hash": w.opened_booster.video_hash,
		} if w.opened_booster else None
	else:
		base["card_preview"] = _serialize_card(w.prize_card) if w.prize_card else None
	return base


def _resell_price_for_card(c: Card) -> int:
	return RESELL_PRICE_BY_RARITY_CENTS.get(c.rarity.value, 0)


# ─── Win settlements: booster pair ──────────────────────────────────────

@sio.on("open_booster_win")
async def open_booster_win(sid, data):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")
	win_id = data.get("win_id")
	if not win_id: return _err("win_id required")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			win = await db.get(Win, uuid.UUID(win_id))
			if win is None or win.user_id != user.id:
				return _err("win not found", "not_found")
			# Capture the booster id before the transition mutates state.
			opened_id = win.opened_booster.id if win.opened_booster else None
			await wt.open_booster_win(db, win.id)
			await db.commit()
			res = await db.execute(
				select(Card).where(
					Card.opened_booster_id == opened_id,
					Card.owner_user_id == user.id,
				)
			)
			cards = res.scalars().all()
		return _ok(settled=True, cards=[_serialize_card(c) for c in cards])
	except wt.WinAlreadySettled as e:
		return _err(str(e), "already_settled")
	except wt.WinKindMismatch as e:
		return _err(str(e), "wrong_kind")
	except Exception as e:
		log.exception("open_booster_win failed")
		return _err(str(e))


@sio.on("resell_booster_win")
async def resell_booster_win(sid, data):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")
	win_id = data.get("win_id")
	if not win_id: return _err("win_id required")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			win = await db.get(Win, uuid.UUID(win_id))
			if win is None or win.user_id != user.id:
				return _err("win not found", "not_found")
			credited = win.resell_price_cents
			await wt.resell_booster_win(db, win.id)
			await db.commit()
		return _ok(settled=True, credited_cents=credited)
	except wt.WinAlreadySettled as e:
		return _err(str(e), "already_settled")
	except wt.WinKindMismatch as e:
		return _err(str(e), "wrong_kind")
	except Exception as e:
		log.exception("resell_booster_win failed")
		return _err(str(e))


@sio.on("ship_booster_win")
async def ship_booster_win(sid, data):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")
	win_id = data.get("win_id")
	address = data.get("address")
	if not win_id or not address: return _err("win_id and address required")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			win = await db.get(Win, uuid.UUID(win_id))
			if win is None or win.user_id != user.id:
				return _err("win not found", "not_found")
			shipment = await wt.ship_booster_win(db, win.id, address)
			await db.commit()
		return _ok(settled=True, shipment_id=str(shipment.id))
	except wt.WinAlreadySettled as e:
		return _err(str(e), "already_settled")
	except wt.WinKindMismatch as e:
		return _err(str(e), "wrong_kind")
	except Exception as e:
		log.exception("ship_booster_win failed")
		return _err(str(e))


# ─── Win settlements: single card ───────────────────────────────────────

@sio.on("keep_card_win")
async def keep_card_win(sid, data):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")
	win_id = data.get("win_id")
	if not win_id: return _err("win_id required")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			win = await db.get(Win, uuid.UUID(win_id))
			if win is None or win.user_id != user.id:
				return _err("win not found", "not_found")
			await wt.keep_card_win(db, win.id)
			await db.commit()
			card = await db.get(Card, win.prize_card_id)
		return _ok(settled=True, card=_serialize_card(card) if card else None)
	except wt.WinAlreadySettled as e:
		return _err(str(e), "already_settled")
	except wt.WinKindMismatch as e:
		return _err(str(e), "wrong_kind")
	except Exception as e:
		log.exception("keep_card_win failed")
		return _err(str(e))


@sio.on("resell_card_win")
async def resell_card_win(sid, data):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")
	win_id = data.get("win_id")
	if not win_id: return _err("win_id required")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			win = await db.get(Win, uuid.UUID(win_id))
			if win is None or win.user_id != user.id:
				return _err("win not found", "not_found")
			credited = win.resell_price_cents
			await wt.resell_card_win(db, win.id)
			await db.commit()
		return _ok(settled=True, credited_cents=credited)
	except wt.WinAlreadySettled as e:
		return _err(str(e), "already_settled")
	except wt.WinKindMismatch as e:
		return _err(str(e), "wrong_kind")
	except Exception as e:
		log.exception("resell_card_win failed")
		return _err(str(e))


@sio.on("ship_card_win")
async def ship_card_win(sid, data):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")
	win_id = data.get("win_id")
	address = data.get("address")
	if not win_id or not address: return _err("win_id and address required")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			win = await db.get(Win, uuid.UUID(win_id))
			if win is None or win.user_id != user.id:
				return _err("win not found", "not_found")
			shipment = await wt.ship_card_win(db, win.id, address)
			await db.commit()
		return _ok(settled=True, shipment_id=str(shipment.id))
	except wt.WinAlreadySettled as e:
		return _err(str(e), "already_settled")
	except wt.WinKindMismatch as e:
		return _err(str(e), "wrong_kind")
	except Exception as e:
		log.exception("ship_card_win failed")
		return _err(str(e))


# ─── Collection actions ────────────────────────────────────────────────

@sio.on("ship_card_from_collection")
async def ship_card_from_collection(sid, data):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")
	card_id = data.get("card_id")
	address = data.get("address")
	if not card_id or not address: return _err("card_id and address required")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			shipment = await wt.ship_card_from_collection(
				db, card_id=uuid.UUID(card_id), user_id=user.id, address=address
			)
			await db.commit()
		return _ok(shipment_id=str(shipment.id))
	except wt.NotOwner:
		return _err("not your card", "not_owner")
	except wt.CardNotActionable as e:
		return _err(str(e), "not_actionable")
	except Exception as e:
		log.exception("ship_card_from_collection failed")
		return _err(str(e))


@sio.on("resell_card_from_collection")
async def resell_card_from_collection(sid, data):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")
	card_id = data.get("card_id")
	if not card_id: return _err("card_id required")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			card = await db.get(Card, uuid.UUID(card_id))
			if card is None or card.owner_user_id != user.id:
				return _err("card not found", "not_found")
			price = _resell_price_for_card(card)
			await wt.resell_card_from_collection(
				db, card_id=card.id, user_id=user.id, resell_price_cents=price,
			)
			await db.commit()
		return _ok(credited_cents=price)
	except wt.NotOwner:
		return _err("not your card", "not_owner")
	except wt.CardNotActionable as e:
		return _err(str(e), "not_actionable")
	except Exception as e:
		log.exception("resell_card_from_collection failed")
		return _err(str(e))


# ─── Inventory read ─────────────────────────────────────────────────────

@sio.on("get_inventory")
async def get_inventory(sid, data=None):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)

			pending = (await db.execute(
				select(Win)
				.where(Win.user_id == user.id, Win.status == WinStatus.PENDING)
				.order_by(Win.created_at.desc())
			)).scalars().all()

			cards = (await db.execute(
				select(Card)
				.where(Card.owner_user_id == user.id, Card.status == CardStatus.IN_COLLECTION)
				.order_by(Card.acquired_at.desc())
			)).scalars().all()

		return _ok(
			pending_wins=[_serialize_pending_win(w) for w in pending],
			cards=[_serialize_card(c) for c in cards],
		)
	except Exception as e:
		log.exception("get_inventory failed")
		return _err(str(e))


# ─── Shipments read ─────────────────────────────────────────────────────

@sio.on("get_shipments")
async def get_shipments(sid, data=None):
	addr = await _require_addr(sid)
	if not addr: return _err("not authenticated", "no_auth")

	try:
		async with async_session() as db:
			user = await wt.get_or_create_user(db, addr)
			shipments = (await db.execute(
				select(Shipment)
				.where(Shipment.user_id == user.id)
				.order_by(Shipment.created_at.desc())
			)).scalars().all()
		return _ok(shipments=[
			{
				"id": str(s.id),
				"status": s.status.value,
				"carrier": s.carrier,
				"tracking_number": s.tracking_number,
				"created_at": int(s.created_at.timestamp()),
				"shipped_at": int(s.shipped_at.timestamp()) if s.shipped_at else None,
				"delivered_at": int(s.delivered_at.timestamp()) if s.delivered_at else None,
			}
			for s in shipments
		])
	except Exception as e:
		log.exception("get_shipments failed")
		return _err(str(e))
