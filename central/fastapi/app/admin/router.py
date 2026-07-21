"""Admin router.

All admin endpoints live under `/admin/*` and require a valid Supabase JWT
(see `auth.py`). Trust-field placeholders are used for crypto until the
revised stack lands — they're well-formed but not cryptographically
meaningful.
"""

import hashlib
import time
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, exists, and_, func

from .. import state as _state
from .. import win_transitions as wt
from ..pi_client import safe_pi_emit, turn_end, request_test_arm
from .auth import AdminIdentity, RequireAdmin
from ..deps import async_session
import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..config import PI_SERVER_URL
from ..versioning import PI_VPS_PROTO

from ..models import (
	Ball, OpenedBooster, ClosedBoosterStock, Card, CommitmentBatch, QueueEntry, Win,
	BallStatus, InventoryStatus, PrizeKind, CardStatus, CardRarity, CardOrigin,
)

# Hard ceiling on the admin enrollment window — matches the ESP-side default.
ENROLL_WINDOW_SECONDS = 10

router = APIRouter(prefix="/admin", tags=["admin"])


def _placeholder_hash(*parts: str) -> str:
	return "0x" + hashlib.sha256("|".join(parts).encode()).hexdigest()


async def _ensure_batch(db) -> CommitmentBatch:
	"""Return the most recent CommitmentBatch, creating a placeholder one if
	none exists yet. Real batch publishing comes back when the crypto stack
	is finalized."""
	batch = await db.scalar(
		select(CommitmentBatch).order_by(CommitmentBatch.published_at.desc())
	)
	if batch is not None:
		return batch
	batch = CommitmentBatch(
		merkle_root=_placeholder_hash("admin-placeholder-root", str(datetime.utcnow())),
		chain_tx_hash=_placeholder_hash("admin-placeholder-tx", str(datetime.utcnow())),
	)
	db.add(batch)
	await db.flush()
	return batch


@router.get("/whoami")
async def whoami(admin: AdminIdentity = RequireAdmin):
	return {"sub": admin["sub"], "email": admin["email"], "role": admin["role"]}


# ─── Balls ──────────────────────────────────────────────────────────────

@router.get("/balls")
async def list_balls(_: AdminIdentity = RequireAdmin):
	async with async_session() as db:
		balls = (await db.execute(
			select(Ball).order_by(Ball.serial)
		)).scalars().all()
		return {
			"balls": [
				{
					"id": str(b.id),
					"serial": b.serial,
					"status": b.status.value,
					"prize_kind": b.prize_kind.value,
					"opened_booster_id": str(b.opened_booster_id) if b.opened_booster_id else None,
					"opened_booster_sku": b.opened_booster.sku if b.opened_booster else None,
					"prize_card_id": str(b.prize_card_id) if b.prize_card_id else None,
				}
				for b in balls
			]
		}


class BindBody(BaseModel):
	opened_booster_id: str


@router.post("/balls/{serial}/bind")
async def bind_ball(
	serial: str,
	body: BindBody,
	_: AdminIdentity = RequireAdmin,
):
	"""Create-or-rebind: if no Ball with this serial exists, create one in
	LOADED status with the chosen OpenedBooster. If one exists and is not
	currently LOADED (i.e., it's been grabbed/voided), rebind it. Reject
	rebinds against a still-LOADED ball — that would silently destroy a
	live binding."""
	try:
		ob_uuid = uuid.UUID(body.opened_booster_id)
	except ValueError:
		raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="opened_booster_id is not a UUID")

	async with async_session() as db:
		ob = await db.scalar(
			select(OpenedBooster).where(OpenedBooster.id == ob_uuid)
		)
		if ob is None:
			raise HTTPException(status_code=404, detail="OpenedBooster not found")
		if ob.status != InventoryStatus.AVAILABLE:
			raise HTTPException(status_code=409, detail=f"OpenedBooster is {ob.status.value}, not AVAILABLE")

		# Reject if some other Ball is already pointing at this OpenedBooster.
		existing_owner = await db.scalar(
			select(Ball).where(Ball.opened_booster_id == ob_uuid, Ball.serial != serial)
		)
		if existing_owner is not None:
			raise HTTPException(
				status_code=409,
				detail=f"OpenedBooster already bound to ball {existing_owner.serial}",
			)

		ball = await db.scalar(select(Ball).where(Ball.serial == serial))
		batch = await _ensure_batch(db)
		secret = _placeholder_hash("admin-secret", serial, str(ob_uuid), str(datetime.utcnow()))

		if ball is None:
			ball = Ball(
				serial=serial,
				prize_kind=PrizeKind.BOOSTER_PAIR,
				opened_booster_id=ob_uuid,
				secret=secret,
				commitment_hash=_placeholder_hash(secret, str(ob_uuid)),
				merkle_proof={"siblings": [], "index": 0, "note": "placeholder"},
				batch_id=batch.id,
				status=BallStatus.LOADED,
			)
			db.add(ball)
			created = True
		else:
			if ball.status == BallStatus.LOADED and (ball.opened_booster_id or ball.prize_card_id):
				raise HTTPException(
					status_code=409,
					detail=f"Ball {serial} is LOADED and already bound — void it before rebinding",
				)
			ball.prize_kind = PrizeKind.BOOSTER_PAIR
			ball.opened_booster_id = ob_uuid
			ball.prize_card_id = None
			ball.secret = secret
			ball.commitment_hash = _placeholder_hash(secret, str(ob_uuid))
			ball.merkle_proof = {"siblings": [], "index": 0, "note": "placeholder"}
			ball.batch_id = batch.id
			ball.status = BallStatus.LOADED
			ball.voided_at = None
			created = False

		await db.commit()
		return {
			"ok": True,
			"created": created,
			"ball": {
				"id": str(ball.id),
				"serial": ball.serial,
				"status": ball.status.value,
				"prize_kind": ball.prize_kind.value,
				"opened_booster_id": str(ball.opened_booster_id),
				"opened_booster_sku": ob.sku,
			},
		}


class BindCardBody(BaseModel):
	card_id: str


@router.post("/balls/{serial}/bind-card")
async def bind_ball_card(
	serial: str,
	body: BindCardBody,
	_: AdminIdentity = RequireAdmin,
):
	"""Single-card analogue of bind_ball: bind a ball to an IN_POOL Card,
	setting prize_kind=SINGLE_CARD. Same create-or-rebind semantics and
	guards as the booster bind."""
	try:
		card_uuid = uuid.UUID(body.card_id)
	except ValueError:
		raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="card_id is not a UUID")

	async with async_session() as db:
		card = await db.scalar(select(Card).where(Card.id == card_uuid))
		if card is None:
			raise HTTPException(status_code=404, detail="Card not found")
		if card.status != CardStatus.IN_POOL:
			raise HTTPException(status_code=409, detail=f"Card is {card.status.value}, not IN_POOL")

		existing_owner = await db.scalar(
			select(Ball).where(Ball.prize_card_id == card_uuid, Ball.serial != serial)
		)
		if existing_owner is not None:
			raise HTTPException(
				status_code=409,
				detail=f"Card already bound to ball {existing_owner.serial}",
			)

		ball = await db.scalar(select(Ball).where(Ball.serial == serial))
		batch = await _ensure_batch(db)
		secret = _placeholder_hash("admin-secret", serial, str(card_uuid), str(datetime.utcnow()))

		if ball is None:
			ball = Ball(
				serial=serial,
				prize_kind=PrizeKind.SINGLE_CARD,
				prize_card_id=card_uuid,
				secret=secret,
				commitment_hash=_placeholder_hash(secret, str(card_uuid)),
				merkle_proof={"siblings": [], "index": 0, "note": "placeholder"},
				batch_id=batch.id,
				status=BallStatus.LOADED,
			)
			db.add(ball)
			created = True
		else:
			if ball.status == BallStatus.LOADED and (ball.opened_booster_id or ball.prize_card_id):
				raise HTTPException(
					status_code=409,
					detail=f"Ball {serial} is LOADED and already bound — void it before rebinding",
				)
			ball.prize_kind = PrizeKind.SINGLE_CARD
			ball.prize_card_id = card_uuid
			ball.opened_booster_id = None
			ball.secret = secret
			ball.commitment_hash = _placeholder_hash(secret, str(card_uuid))
			ball.merkle_proof = {"siblings": [], "index": 0, "note": "placeholder"}
			ball.batch_id = batch.id
			ball.status = BallStatus.LOADED
			ball.voided_at = None
			created = False

		await db.commit()
		return {
			"ok": True,
			"created": created,
			"ball": {
				"id": str(ball.id),
				"serial": ball.serial,
				"status": ball.status.value,
				"prize_kind": ball.prize_kind.value,
				"prize_card_id": str(card_uuid),
			},
		}


@router.post("/balls/{serial}/void")
async def void_ball(serial: str, _: AdminIdentity = RequireAdmin):
	"""Mark a LOADED ball VOIDED, releasing its bound prize back to the pool.
	Delegates to win_transitions.void_ball (single short transaction)."""
	async with async_session() as db:
		ball = await db.scalar(select(Ball).where(Ball.serial == serial))
		if ball is None:
			raise HTTPException(status_code=404, detail=f"Ball {serial} not found")
		try:
			await wt.void_ball(db, ball.id)
		except wt.BallNotAvailable as e:
			raise HTTPException(status_code=409, detail=str(e))
		await db.commit()
		return {
			"ok": True,
			"ball": {"id": str(ball.id), "serial": ball.serial, "status": ball.status.value},
		}


# ─── Tag enrollment ─────────────────────────────────────────────────────

class CreateBallBody(BaseModel):
	serial: str


@router.post("/balls/enroll/start")
async def enroll_start(_: AdminIdentity = RequireAdmin):
	"""Open a 10s window where the next tag presented to the antenna is
	captured into state.enroll_pending. Refuses if the cabinet isn't fully
	idle (someone playing or anyone queued)."""
	if _state.current_player is not None:
		raise HTTPException(status_code=409, detail="A turn is in progress")

	async with async_session() as db:
		qcount = await db.scalar(
			select(func.count()).select_from(QueueEntry).where(
				QueueEntry.status.in_(["queued", "active"])
			)
		)
	if qcount and qcount > 0:
		raise HTTPException(status_code=409, detail=f"{qcount} players still queued")

	# Don't stack enrollments. If one's open but expired, replace it; if
	# open and active, refuse so the admin notices the existing window.
	now = time.time()
	if _state.enroll_pending and _state.enroll_pending.get("expires_at", 0) > now \
		and not _state.enroll_pending.get("timed_out") \
		and not _state.enroll_pending.get("scanned_ball_serial"):
		raise HTTPException(status_code=409, detail="Enrollment already in progress")

	_state.enroll_pending = {
		"expires_at": now + ENROLL_WINDOW_SECONDS,
		"scanned_ball_serial": None,
		"timed_out": False,
	}
	timeout_ms = ENROLL_WINDOW_SECONDS * 1000
	ok = await safe_pi_emit("enroll", {"timeout_ms": timeout_ms})
	if not ok:
		_state.enroll_pending = None
		raise HTTPException(status_code=503, detail="Cabinet is offline")
	return {"ok": True, "timeout_ms": timeout_ms}


@router.get("/balls/enroll/status")
async def enroll_status(_: AdminIdentity = RequireAdmin):
	"""Poll target for the admin UI's enroll dialog. Statuses:
	  - "idle"     — no enrollment open.
	  - "waiting"  — window open, no tag yet.
	  - "scanned"  — tag captured; serial in scanned_ball_serial.
	  - "timeout"  — window elapsed with no scan.
	"""
	p = _state.enroll_pending
	if p is None:
		return {"status": "idle"}
	now = time.time()
	if p.get("scanned_ball_serial"):
		return {
			"status": "scanned",
			"ball_serial": p["scanned_ball_serial"],
		}
	if p.get("timed_out") or p["expires_at"] <= now:
		return {"status": "timeout"}
	return {
		"status": "waiting",
		"remaining_seconds": max(0, int(p["expires_at"] - now)),
	}


@router.post("/balls/enroll/cancel")
async def enroll_cancel(_: AdminIdentity = RequireAdmin):
	"""Clear the enroll slot. Useful if the admin closes the dialog mid-
	window. Does not currently signal cancel to the ESP — the window will
	just close on its own there, and any later tag_scanned for it will be
	ignored on arrival."""
	_state.enroll_pending = None
	return {"ok": True}


@router.post("/balls")
async def create_ball(body: CreateBallBody, _: AdminIdentity = RequireAdmin):
	"""Create a Ball row with no OpenedBooster bound yet. Used after a
	successful enrollment scan — the admin then opens the "Bind tag"
	dialog to attach an OpenedBooster.
	"""
	serial = body.serial.strip()
	if not serial:
		raise HTTPException(status_code=400, detail="serial is required")
	async with async_session() as db:
		dup = await db.scalar(select(Ball).where(Ball.serial == serial))
		if dup is not None:
			raise HTTPException(status_code=409, detail=f"Ball {serial} already exists")
		batch = await _ensure_batch(db)
		secret = _placeholder_hash("admin-create", serial, str(datetime.utcnow()))
		ball = Ball(
			serial=serial,
			prize_kind=PrizeKind.BOOSTER_PAIR,   # provisional; rebind sets the real kind
			opened_booster_id=None,
			secret=secret,
			commitment_hash=_placeholder_hash(secret, serial),
			merkle_proof={"siblings": [], "index": 0, "note": "placeholder-unbound"},
			batch_id=batch.id,
			status=BallStatus.LOADED,
		)
		db.add(ball)
		await db.commit()
		# Clear the enroll slot now that we've consumed it.
		if _state.enroll_pending and _state.enroll_pending.get("scanned_ball_serial") == serial:
			_state.enroll_pending = None
		return {
			"ok": True,
			"ball": {
				"id": str(ball.id),
				"serial": ball.serial,
				"status": ball.status.value,
			},
		}


# ─── Inventory ───────────────────────────────────────────────────────────

@router.get("/inventory/opened-boosters")
async def list_opened_boosters(
	bindable: Optional[bool] = None,
	_: AdminIdentity = RequireAdmin,
):
	"""When `bindable=true`, return only AVAILABLE OpenedBoosters not yet
	owned by another Ball — the dropdown the bind form uses."""
	async with async_session() as db:
		q = select(OpenedBooster).order_by(OpenedBooster.sku, OpenedBooster.id)
		if bindable:
			ball_already_bound = select(Ball.opened_booster_id).where(
				Ball.opened_booster_id == OpenedBooster.id
			)
			q = q.where(
				and_(
					OpenedBooster.status == InventoryStatus.AVAILABLE,
					~exists(ball_already_bound),
				)
			)
		obs = (await db.execute(q)).scalars().all()
		return {
			"opened_boosters": [
				{
					"id": str(ob.id),
					"sku": ob.sku,
					"status": ob.status.value,
					"video_url": ob.video_url,
					"filmed_at": ob.filmed_at.isoformat() if ob.filmed_at else None,
				}
				for ob in obs
			]
		}


@router.get("/inventory/closed-boosters")
async def list_closed_boosters(_: AdminIdentity = RequireAdmin):
	"""Sealed-pack availability per SKU. Each row is a SKU + an in_stock flag —
	sealed packs are fungible, so we track availability, not individual units."""
	async with async_session() as db:
		rows = (await db.execute(
			select(ClosedBoosterStock).order_by(ClosedBoosterStock.sku)
		)).scalars().all()
		return {
			"closed_boosters": [
				{"sku": r.sku, "in_stock": r.in_stock}
				for r in rows
			]
		}


@router.get("/inventory/cards")
async def list_cards(_: AdminIdentity = RequireAdmin):
	async with async_session() as db:
		rows = (await db.execute(
			select(Card).order_by(Card.set, Card.number).limit(200)
		)).scalars().all()
		return {
			"cards": [
				{
					"id": str(r.id),
					"set": r.set,
					"number": r.number,
					"rarity": r.rarity.value,
					"status": r.status.value,
				}
				for r in rows
			]
		}


# ─── Inventory create / edit / import ────────────────────────────────────

def _parse_dt(value: Optional[str]) -> datetime:
	"""Parse an ISO-8601 string into a naive-UTC datetime (the inventory
	columns are timezone-naive). Defaults to now when empty."""
	if not value:
		return datetime.utcnow()
	try:
		dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
	except ValueError:
		raise HTTPException(status_code=400, detail=f"invalid datetime: {value}")
	if dt.tzinfo is not None:
		dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
	return dt


def _parse_rarity(value: str) -> CardRarity:
	try:
		return CardRarity(value)
	except ValueError:
		opts = [r.value for r in CardRarity]
		raise HTTPException(status_code=400, detail=f"invalid rarity {value!r}; one of {opts}")


def _new_opened_booster(db, data: dict) -> OpenedBooster:
	sku = (data.get("sku") or "").strip()
	video_url = (data.get("video_url") or "").strip()
	if not sku or not video_url:
		raise HTTPException(status_code=400, detail="opened booster needs sku and video_url")
	# video_hash is UNIQUE NOT NULL; derive a placeholder from the URL when the
	# real content hash isn't supplied yet (parity with the crypto placeholders).
	video_hash = (data.get("video_hash") or "").strip() or _placeholder_hash(
		"opened-booster", sku, video_url, str(datetime.utcnow())
	)
	ob = OpenedBooster(
		sku=sku,
		video_url=video_url,
		video_hash=video_hash,
		filmed_at=_parse_dt(data.get("filmed_at")),
		status=InventoryStatus.AVAILABLE,
	)
	db.add(ob)
	return ob


async def _upsert_closed_stock(db, data: dict) -> str:
	"""Upsert a per-SKU sealed-pack availability flag. Creating the same SKU
	again just updates its in_stock flag (idempotent restock)."""
	sku = (data.get("sku") or "").strip()
	if not sku:
		raise HTTPException(status_code=400, detail="closed booster needs sku")
	in_stock = data.get("in_stock")
	in_stock = True if in_stock is None else bool(in_stock)
	stmt = pg_insert(ClosedBoosterStock).values(sku=sku, in_stock=in_stock)
	stmt = stmt.on_conflict_do_update(
		index_elements=["sku"], set_={"in_stock": in_stock},
	)
	await db.execute(stmt)
	return sku


def _new_card(db, data: dict) -> Card:
	for f in ("set", "number", "image_url"):
		if not (data.get(f) or "").strip():
			raise HTTPException(status_code=400, detail=f"card needs {f}")
	card = Card(
		set=data["set"].strip(),
		number=data["number"].strip(),
		rarity=_parse_rarity(data.get("rarity") or ""),
		image_url=data["image_url"].strip(),
		condition=(data.get("condition") or None),
		origin=CardOrigin.SINGLE_PRIZE,
		status=CardStatus.IN_POOL,
	)
	db.add(card)
	return card


class CreateOpenedBoosterBody(BaseModel):
	sku: str
	video_url: str
	video_hash: Optional[str] = None
	filmed_at: Optional[str] = None


@router.post("/inventory/opened-boosters")
async def create_opened_booster(body: CreateOpenedBoosterBody, _: AdminIdentity = RequireAdmin):
	async with async_session() as db:
		ob = _new_opened_booster(db, body.dict())
		await db.commit()
		return {"ok": True, "id": str(ob.id), "sku": ob.sku}


class CreateClosedBoosterBody(BaseModel):
	sku: str
	in_stock: bool = True


@router.post("/inventory/closed-boosters")
async def create_closed_booster(body: CreateClosedBoosterBody, _: AdminIdentity = RequireAdmin):
	"""Register (or restock) a sealed-pack SKU as available / not. Idempotent."""
	async with async_session() as db:
		sku = await _upsert_closed_stock(db, {"sku": body.sku, "in_stock": body.in_stock})
		await db.commit()
		return {"ok": True, "sku": sku, "in_stock": body.in_stock}


class PatchClosedStockBody(BaseModel):
	in_stock: bool


@router.patch("/inventory/closed-boosters/{sku}")
async def patch_closed_stock(sku: str, body: PatchClosedStockBody, _: AdminIdentity = RequireAdmin):
	"""Flip a SKU's availability — what you do when you run out of / restock a
	sealed-pack SKU."""
	async with async_session() as db:
		row = await db.scalar(
			select(ClosedBoosterStock).where(ClosedBoosterStock.sku == sku)
		)
		if row is None:
			raise HTTPException(status_code=404, detail=f"SKU {sku} not registered")
		row.in_stock = body.in_stock
		await db.commit()

		# Don't block the operator — a set can go out of print and they have no
		# choice. Block the MACHINE, and tell them exactly what they just
		# orphaned so they can void or rebind those balls.
		orphaned = [
			b for b in await wt.unclaimable_loaded_balls(db)
			if b["reason"].endswith("is out of stock")
		]

	fault = await machine.refresh_inventory_fault()
	return {
		"ok": True,
		"sku": sku,
		"in_stock": row.in_stock,
		# Non-empty => the queue is now PAUSED until these are voided or rebound.
		"orphaned_balls": orphaned,
		"queue_paused": bool(fault),
	}


class CreateCardBody(BaseModel):
	set: str
	number: str
	rarity: str
	image_url: str
	condition: Optional[str] = None


@router.post("/inventory/cards")
async def create_card(body: CreateCardBody, _: AdminIdentity = RequireAdmin):
	async with async_session() as db:
		card = _new_card(db, body.dict())
		await db.commit()
		return {"ok": True, "id": str(card.id)}


class PatchCardBody(BaseModel):
	set: Optional[str] = None
	number: Optional[str] = None
	rarity: Optional[str] = None
	image_url: Optional[str] = None
	condition: Optional[str] = None


@router.patch("/inventory/cards/{card_id}")
async def patch_card(card_id: str, body: PatchCardBody, _: AdminIdentity = RequireAdmin):
	"""Edit a card's metadata. Only IN_POOL cards are editable — once a card is
	reserved/owned/shipped its identity is locked."""
	try:
		cid = uuid.UUID(card_id)
	except ValueError:
		raise HTTPException(status_code=400, detail="card_id is not a UUID")
	async with async_session() as db:
		card = await db.get(Card, cid)
		if card is None:
			raise HTTPException(status_code=404, detail="Card not found")
		if card.status != CardStatus.IN_POOL:
			raise HTTPException(status_code=409, detail=f"Card is {card.status.value}, not editable")
		if body.set is not None:
			card.set = body.set.strip()
		if body.number is not None:
			card.number = body.number.strip()
		if body.rarity is not None:
			card.rarity = _parse_rarity(body.rarity)
		if body.image_url is not None:
			card.image_url = body.image_url.strip()
		if body.condition is not None:
			card.condition = body.condition or None
		await db.commit()
		return {"ok": True, "id": str(card.id)}


class PatchOpenedBoosterBody(BaseModel):
	sku: Optional[str] = None
	video_url: Optional[str] = None
	filmed_at: Optional[str] = None


@router.patch("/inventory/opened-boosters/{ob_id}")
async def patch_opened_booster(ob_id: str, body: PatchOpenedBoosterBody, _: AdminIdentity = RequireAdmin):
	try:
		oid = uuid.UUID(ob_id)
	except ValueError:
		raise HTTPException(status_code=400, detail="ob_id is not a UUID")
	async with async_session() as db:
		ob = await db.get(OpenedBooster, oid)
		if ob is None:
			raise HTTPException(status_code=404, detail="OpenedBooster not found")
		if ob.status != InventoryStatus.AVAILABLE:
			raise HTTPException(status_code=409, detail=f"OpenedBooster is {ob.status.value}, not editable")
		if body.sku is not None:
			ob.sku = body.sku.strip()
		if body.video_url is not None:
			ob.video_url = body.video_url.strip()
		if body.filmed_at is not None:
			ob.filmed_at = _parse_dt(body.filmed_at)
		await db.commit()
		return {"ok": True, "id": str(ob.id)}


@router.post("/inventory/import")
async def import_inventory(items: List[dict], _: AdminIdentity = RequireAdmin):
	"""Bulk-create inventory in one transaction. Each item is a dict with a
	`type` of "card" | "opened_booster" | "closed_booster" plus that type's
	fields. All-or-nothing: a bad row rolls back the whole batch."""
	counts = {"card": 0, "opened_booster": 0, "closed_booster": 0}
	async with async_session() as db:
		for i, item in enumerate(items):
			kind = (item or {}).get("type")
			if kind == "card":
				_new_card(db, item)
			elif kind == "opened_booster":
				_new_opened_booster(db, item)
			elif kind == "closed_booster":
				await _upsert_closed_stock(db, item)
			else:
				raise HTTPException(status_code=400, detail=f"item {i}: unknown type {kind!r}")
			counts[kind] += 1
		await db.commit()
	return {"ok": True, "counts": counts}


# ─── Plays history ───────────────────────────────────────────────────────

def _describe_prize(w: Win) -> dict:
	"""Prize summary for a won play. Sourced from the ball's binding (stable)
	rather than the Win's reserved_by relationships, which are cleared once the
	player settles — so the history keeps showing what was won."""
	info = {
		"win_id": str(w.id),
		"win_status": w.status.value,
		"prize_kind": w.prize_kind.value,
		"resell_price_cents": w.resell_price_cents,
		"expires_at": w.expires_at.isoformat() if w.expires_at else None,
	}
	if w.prize_kind == PrizeKind.BOOSTER_PAIR:
		ob = w.ball.opened_booster if w.ball else None
		info["sku"] = ob.sku if ob else None
		info["label"] = f"Booster pair · {ob.sku}" if ob else "Booster pair"
	else:
		c = w.prize_card
		if c is not None:
			info["label"] = f"{c.set} {c.number} · {c.rarity.value}"
			info["card"] = {
				"set": c.set, "number": c.number,
				"rarity": c.rarity.value, "image_url": c.image_url,
			}
		else:
			info["label"] = "Single card"
	return info


@router.get("/plays")
async def list_plays(limit: int = 100, _: AdminIdentity = RequireAdmin):
	"""Recent plays (turns). Each row is a QueueEntry; a play is 'won' iff a Win
	row settled against it (a bound ball was grabbed), otherwise 'lost'. Wins
	carry their prize."""
	limit = max(1, min(limit, 500))
	async with async_session() as db:
		entries = (await db.execute(
			select(QueueEntry).order_by(QueueEntry.created_at.desc()).limit(limit)
		)).scalars().all()

		win_by_q: dict = {}
		qids = [e.id for e in entries]
		if qids:
			wins = (await db.execute(
				select(Win).where(Win.queue_entry_id.in_(qids))
			)).scalars().all()
			win_by_q = {w.queue_entry_id: w for w in wins}

		plays = []
		for e in entries:
			w = win_by_q.get(e.id)
			if w is not None:
				outcome = "won"
			elif e.status == "played":
				outcome = "lost"
			elif e.status == "cancelled":
				outcome = "cancelled"
			else:
				outcome = "in_progress"
			plays.append({
				"id": e.id,
				"address": e.address,
				"status": e.status,
				"created_at": e.created_at.isoformat() if e.created_at else None,
				"played_at": e.played_at.isoformat() if e.played_at else None,
				"ended_at": e.ended_at.isoformat() if e.ended_at else None,
				"onchain_win": bool(e.win),
				"outcome": outcome,
				"prize": _describe_prize(w) if w is not None else None,
			})
		return {"plays": plays}


# ─── Cabinet ops ─────────────────────────────────────────────────────────

@router.get("/cabinet/status")
async def cabinet_status(_: AdminIdentity = RequireAdmin):
	"""Live snapshot for the ops page: Pi link health, who's playing, how many
	are queued, and the mirrored chute fault (None == healthy)."""
	async with async_session() as db:
		queue_length = await db.scalar(
			select(func.count()).select_from(QueueEntry).where(
				QueueEntry.status == "queued"
			)
		)
	return {
		"pi_connected": _state.pi_connected,
		# Any of these pauses the queue until it's resolved.
		"version_fault": _state.version_fault,
		"inventory_fault": _state.inventory_fault,
		"current_player": _state.current_player,
		"queue_length": int(queue_length or 0),
		"cabinet_fault": _state.cabinet_fault,
		# The full VPS/Pi/ESP protocol chain, for the ops page. Numbers are the
		# last-seen snapshot (present even when healthy); *_ok are the live
		# equality verdicts. vps_proto is this process's own constant.
		"versions": {
			"vps_proto": PI_VPS_PROTO,
			"pi_proto": _state.pi_proto,
			"esp_proto": _state.esp_proto,
			"esp_fw": _state.esp_fw,
			"pi_fw": _state.pi_fw,
			"pi_vps_ok": _state.pi_proto == PI_VPS_PROTO,
			"esp_pi_ok": _state.esp_pi_ok,
		},
	}


@router.post("/cabinet/test-arm")
async def cabinet_test_arm(_: AdminIdentity = RequireAdmin):
	"""Diagnostic 'test win': arm the chute so an operator can drop a ball and
	see the real ESP sequence (break-beams, RFID, solenoid). Blocks until the
	verdict or timeout. Does NOT create a Win. Refuses if a turn is in progress."""
	if _state.current_player is not None:
		raise HTTPException(status_code=409, detail="A turn is in progress")
	try:
		result = await request_test_arm(timeout=20.0)
	except Exception as e:
		raise HTTPException(status_code=503, detail=str(e))
	return {"ok": True, "result": result}


@router.get("/cabinet/esp")
async def cabinet_esp(_: AdminIdentity = RequireAdmin):
	"""On-demand chute-ESP status — proxies the Pi server's /health (ESP link,
	firmware, latched fault, live ping). 503 if the Pi is unreachable."""
	url = PI_SERVER_URL.rstrip("/") + "/health"
	try:
		async with httpx.AsyncClient(timeout=4.0) as client:
			r = await client.get(url)
		r.raise_for_status()
		return r.json()
	except Exception as e:
		raise HTTPException(status_code=503, detail=f"Pi /health unreachable: {e}")


@router.post("/cabinet/clear_fault")
async def clear_fault(_: AdminIdentity = RequireAdmin):
	"""Relay a fault_clear to the Pi (which forwards it to the chute ESP32,
	releasing the latch) and clear the local mirror."""
	ok = await safe_pi_emit("fault_clear")
	if not ok:
		raise HTTPException(status_code=503, detail="Cabinet is offline")
	_state.cabinet_fault = None
	return {"ok": True}


@router.post("/queue/force_turn_end")
async def force_turn_end(_: AdminIdentity = RequireAdmin):
	"""Operator override to unstick the queue: run the same transition the Pi's
	`turn_end` triggers — settle the active entry and advance to the next."""
	if _state.current_player is None:
		raise HTTPException(status_code=409, detail="No turn is in progress")
	await turn_end()
	return {"ok": True}
