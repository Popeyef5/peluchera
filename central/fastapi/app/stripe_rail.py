"""Card rail: Stripe saved-card charging + webhook convergence.

Flow ("remember card", no held balance — every charge buys exactly one play):
  1. `card_setup` (socket): ensure a Stripe Customer for the user, mint a
     SetupIntent; the frontend collects the card once with Stripe Elements.
  2. `pay_card` (socket): create a PENDING Payment, then charge the saved card
     with an off-session PaymentIntent. If Stripe answers "succeeded"
     synchronously (the common no-3DS case) we confirm right there and the ack
     carries the queue position — same UX as the crypto rail.
  3. `/payments/stripe/webhook` (HTTP): the safety net. If the synchronous path
     didn't land (processing status, crash between charge and confirm, 3DS),
     `payment_intent.succeeded` confirms the pending Payment idempotently and
     notifies the player's room; `payment_intent.payment_failed` marks FAILED.

Confirmation is idempotent by construction: the Payment row is locked
(FOR UPDATE) and only a PENDING row can be confirmed, so the socket path and
the webhook can race safely. The Stripe charge itself is deduplicated with an
idempotency key derived from the Payment id.

The stripe SDK is synchronous — every call runs in an executor.
"""
import asyncio
import functools
import secrets
import uuid
from typing import Optional, Tuple

import stripe
from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from .config import STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
from .db import async_session
from .logging import log
from .models import Payment, PaymentStatus, User
from .payments import confirm_payment

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

router = APIRouter(prefix="/payments/stripe", tags=["payments"])


def stripe_enabled() -> bool:
    return bool(STRIPE_SECRET_KEY)


# ─── Sync SDK helpers (run these in an executor) ────────────────────────

def _create_customer(wallet_address: Optional[str]) -> str:
    customer = stripe.Customer.create(
        metadata={"wallet_address": wallet_address or ""},
    )
    return customer["id"]


def _create_setup_intent(customer_id: str) -> str:
    intent = stripe.SetupIntent.create(
        customer=customer_id,
        usage="off_session",
        payment_method_types=["card"],
    )
    return intent["client_secret"]


def _saved_card(customer_id: str) -> Optional[dict]:
    """First saved card for the customer, as {id, brand, last4} — or None."""
    methods = stripe.PaymentMethod.list(customer=customer_id, type="card")
    data = methods.get("data", [])
    if not data:
        return None
    pm = data[0]
    card = pm.get("card", {}) or {}
    return {"id": pm["id"], "brand": card.get("brand"), "last4": card.get("last4")}


def _charge_saved_card(customer_id: str, payment_method_id: str,
                       amount_cents: int, payment_id: str) -> dict:
    """Off-session charge of the saved card. Returns {id, status}."""
    intent = stripe.PaymentIntent.create(
        amount=amount_cents,
        currency="usd",
        customer=customer_id,
        payment_method=payment_method_id,
        off_session=True,
        confirm=True,
        metadata={"payment_id": payment_id},
        idempotency_key="pay-%s" % payment_id,
    )
    return {"id": intent["id"], "status": intent["status"]}


async def _in_executor(fn, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, functools.partial(fn, *args, **kwargs))


# ─── Idempotent confirmation (shared by socket ack path and webhook) ────

async def confirm_card_payment(payment_id: uuid.UUID, pi_id: str) -> Tuple[Optional[int], Optional[str]]:
    """Confirm a PENDING card Payment exactly once.

    Returns (position, address) on the winning call; (None, None) if the row is
    missing or another path (socket ack vs. webhook) already settled it.
    """
    async with async_session() as db:
        payment = await db.scalar(
            select(Payment).where(Payment.id == payment_id).with_for_update()
        )
        if payment is None:
            log.warning("stripe: no Payment %s for PaymentIntent %s", payment_id, pi_id)
            return None, None
        if payment.status != PaymentStatus.PENDING:
            return None, None

        payment.ref = pi_id
        # Synthetic turn key, same as the crypto rail — no contract behind it.
        position = await confirm_payment(db, payment, secrets.token_bytes(32))
        return position, payment.address


async def fail_card_payment(payment_id: uuid.UUID, pi_id: Optional[str] = None) -> Optional[str]:
    """Mark a PENDING card Payment FAILED. Returns the address, or None.

    `ref` is only set when a real (unique) PaymentIntent id is available —
    never a placeholder, since `payment.ref` is unique and NULL repeats freely.
    """
    async with async_session() as db:
        payment = await db.scalar(
            select(Payment).where(Payment.id == payment_id).with_for_update()
        )
        if payment is None or payment.status != PaymentStatus.PENDING:
            return None
        payment.status = PaymentStatus.FAILED
        if pi_id:
            payment.ref = pi_id
        await db.commit()
        return payment.address


# ─── Customer plumbing used by the socket handlers ──────────────────────

async def ensure_customer(db, user: User) -> str:
    """Get or lazily create the user's Stripe Customer id (commits on create)."""
    if user.stripe_customer_id:
        return user.stripe_customer_id
    customer_id = await _in_executor(_create_customer, user.wallet_address)
    user.stripe_customer_id = customer_id
    await db.commit()
    return customer_id


# ─── Webhook (the convergence safety net) ───────────────────────────────

def _payment_id_from_event(event) -> Optional[uuid.UUID]:
    meta = event["data"]["object"].get("metadata", {}) or {}
    raw = meta.get("payment_id")
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


@router.post("/webhook")
async def stripe_webhook(request: Request):
    # Imported here to avoid a module cycle (sio_instance imports are pulled in
    # through app/__init__ which mounts this router).
    from .socket.sio_instance import sio

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError) as e:
        log.warning("stripe webhook rejected: %s", e)
        return Response(status_code=400)

    etype = event["type"]
    if etype in ("payment_intent.succeeded", "payment_intent.payment_failed"):
        payment_id = _payment_id_from_event(event)
        pi_id = event["data"]["object"]["id"]
        if payment_id is None:
            # Not one of ours (e.g. a charge made from the dashboard) — ack it.
            return Response(status_code=200)

        if etype == "payment_intent.succeeded":
            position, address = await confirm_card_payment(payment_id, pi_id)
            if position is not None and address:
                # The synchronous ack path didn't land — tell the player.
                await sio.emit("payment_confirmed", {"position": position}, room=address)
                log.info("stripe webhook confirmed payment %s (pos %s)", payment_id, position)
        else:
            address = await fail_card_payment(payment_id, pi_id)
            if address:
                await sio.emit("payment_failed", {"error": "card payment failed"}, room=address)
                log.info("stripe webhook failed payment %s", payment_id)

    return Response(status_code=200)
