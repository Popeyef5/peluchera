"""Admin router.

All admin endpoints live under `/admin/*` and require a valid Supabase JWT
(see `auth.py`). Trust-field placeholders are used for crypto until the
revised stack lands — they're well-formed but not cryptographically
meaningful.
"""

import hashlib
import time
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, exists, and_, func

from .. import state as _state
from ..pi_client import safe_pi_emit
from .auth import AdminIdentity, RequireAdmin
from ..deps import async_session
from ..models import (
	Ball, OpenedBooster, ClosedBooster, Card, CommitmentBatch, QueueEntry,
	BallStatus, InventoryStatus, PrizeKind,
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
			if ball.status == BallStatus.LOADED:
				raise HTTPException(
					status_code=409,
					detail=f"Ball {serial} is still LOADED — settle or void the current binding first",
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


@router.post("/balls/{serial}/void")
async def void_ball(serial: str, _: AdminIdentity = RequireAdmin):
	"""TODO: mark a ball VOIDED — releases its bound OpenedBooster and
	flips any open Win to expired/refund."""
	return {"ok": False, "error": "not implemented"}


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
	async with async_session() as db:
		rows = (await db.execute(
			select(ClosedBooster).order_by(ClosedBooster.sku, ClosedBooster.id)
		)).scalars().all()
		return {
			"closed_boosters": [
				{"id": str(r.id), "sku": r.sku, "status": r.status.value}
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


# ─── Cabinet ops (still stubs) ───────────────────────────────────────────

@router.get("/cabinet/status")
async def cabinet_status(_: AdminIdentity = RequireAdmin):
	return {"claw_on": False, "current_player": None, "queue_length": 0}


@router.post("/cabinet/clear_fault")
async def clear_fault(_: AdminIdentity = RequireAdmin):
	return {"ok": False, "error": "not implemented"}


@router.post("/queue/force_turn_end")
async def force_turn_end(_: AdminIdentity = RequireAdmin):
	return {"ok": False, "error": "not implemented"}
