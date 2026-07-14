"""Socket.IO handlers for the card rail (Stripe saved-card pay-to-play).

`card_setup` runs once per new card (Stripe Elements on the frontend);
`pay_card` charges the saved card per play. Both converge on the same
initiate/confirm Payment seam as the crypto rail (see app/payments.py and
app/stripe_rail.py for the webhook safety net).
"""
import stripe
from sqlalchemy import select

from .sio_instance import sio
from ..config import TICKET_PRICE_CENTS, free_play
from ..deps import async_session
from ..logging import log
from ..models import Round, PaymentMethod
from ..payments import already_in_queue, initiate_payment
from ..state import sid_to_addr
from ..win_transitions import get_or_create_user
from ..stripe_rail import (
    stripe_enabled, ensure_customer, confirm_card_payment,
    fail_card_payment, _in_executor, _create_setup_intent,
    _saved_card, _charge_saved_card,
)


def _err(msg):
    return {"status": "error", "position": -1, "error": msg}


@sio.on("card_setup")
async def card_setup(sid, data=None):
    """Prepare card capture: returns a SetupIntent client_secret for Stripe
    Elements, plus the already-saved card (brand/last4) if there is one."""
    addr = sid_to_addr.get(sid)
    if not addr:
        return _err("not connected")
    if not stripe_enabled():
        return _err("card payments disabled")

    try:
        async with async_session() as db:
            user = await get_or_create_user(db, addr)
            customer_id = await ensure_customer(db, user)

        client_secret = await _in_executor(_create_setup_intent, customer_id)
        saved = await _in_executor(_saved_card, customer_id)
        return {"status": "ok", "client_secret": client_secret, "saved_card": saved}
    except Exception as e:
        log.exception("card_setup failed for %s", addr)
        return _err("could not start card setup: %s" % e)


@sio.on("pay_card")
async def pay_card(sid, data=None):
    """Charge the saved card for one play.

    Ack mirrors `pay_crypto`: {"status": "ok", "position": N} when the charge
    settles synchronously. If Stripe reports the charge as still processing,
    the ack is {"status": "processing"} and the player gets a targeted
    `payment_confirmed` / `payment_failed` room event from the webhook.
    """
    addr = sid_to_addr.get(sid)
    if not addr:
        return _err("not connected")
    if free_play():
        # Plays are comped — charging a card now would be taking money for
        # something we're giving away.
        return _err("payments are disabled")
    if not stripe_enabled():
        return _err("card payments disabled")

    async with async_session() as db:
        round_ = await db.scalar(select(Round).order_by(Round.created_at.desc()))
        if await already_in_queue(db, addr, round_.id):
            log.warning("Rejected player %s for double entry" % addr)
            return _err("user already in queue")

        user = await get_or_create_user(db, addr)
        customer_id = await ensure_customer(db, user)

        saved = await _in_executor(_saved_card, customer_id)
        if not saved:
            return _err("no saved card — run card setup first")

        # Commit the PENDING row before charging so the webhook can find it
        # even if we crash right after the Stripe call.
        payment = await initiate_payment(db, addr, PaymentMethod.CARD, TICKET_PRICE_CENTS)
        payment.user_id = user.id
        await db.commit()
        payment_id = payment.id

    try:
        pi = await _in_executor(
            _charge_saved_card, customer_id, saved["id"],
            TICKET_PRICE_CENTS, str(payment_id),
        )
    except stripe.CardError as e:
        # A decline still creates a PaymentIntent; record its id if present.
        pi_obj = getattr(e, "payment_intent", None) or {}
        pi_ref = pi_obj.get("id") if isinstance(pi_obj, dict) else getattr(pi_obj, "id", None)
        await fail_card_payment(payment_id, pi_ref)
        log.warning("pay_card: card declined for %s: %s", addr, e)
        return _err("card declined")
    except Exception as e:
        await fail_card_payment(payment_id)
        log.exception("pay_card: charge failed for %s", addr)
        return _err("charge failed: %s" % e)

    if pi["status"] == "succeeded":
        position, _ = await confirm_card_payment(payment_id, pi["id"])
        if position is None:
            # The webhook beat us to it — the row is already CONFIRMED and the
            # player_queued broadcast went out; report the current queue depth.
            from ..models import QueueEntry
            from sqlalchemy import func
            async with async_session() as db:
                position = await db.scalar(
                    select(func.count()).select_from(QueueEntry)
                    .where(QueueEntry.status == "queued")
                )
        return {"status": "ok", "position": position}

    if pi["status"] == "processing":
        # Confirmation arrives via the webhook → `payment_confirmed` room event.
        return {"status": "processing"}

    # requires_action & friends: off-session 3DS can't be completed here.
    await fail_card_payment(payment_id, pi["id"])
    return _err("card requires authentication — re-add it via card setup")
