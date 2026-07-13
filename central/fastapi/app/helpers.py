import asyncio, requests
from datetime import datetime, timedelta
from .logging import log
from .config import (
    PRIVATE_KEY, CLAW_ADDRESS, BASE_RPC_HTTP, CHAIN_ID, BYPASS_PAYMENT,
    TREASURY_ADDRESS, TREASURY_PRIVATE_KEY, USDC_TOKEN_ADDRESS, USDC_DECIMALS,
    CHARGEBACK_HOLD_DAYS,
)
from web3 import Web3
from .abi import claw_abi, erc20_abi
from .models import (
    QueueEntry, Withdrawal, Round, User, LedgerEntry, LedgerKind,
    Win, Payment, PaymentMethod,
)

from sqlalchemy import select, func


# Ledger kinds that add to / subtract from the off-chain winnings balance.
# Balance accrues ONLY from wins (resells) — never deposits — by product design.
_CREDIT_KINDS = (
    LedgerKind.DEPOSIT, LedgerKind.RESELL, LedgerKind.AUTO_RESELL,
    LedgerKind.CARD_RESELL, LedgerKind.BET_REFUND,
)
_DEBIT_KINDS = (LedgerKind.WITHDRAWAL, LedgerKind.BET_PLACED)


async def off_chain_balance_cents(db, user_id) -> int:
    """The user's total balance in cents, summed from the ledger (credits minus
    withdrawals). This is what they *have*; see withdrawable_balance_cents for
    what they can withdraw right now (chargeback holds excluded)."""
    credits = await db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount_cents), 0))
        .where(LedgerEntry.user_id == user_id)
        .where(LedgerEntry.kind.in_(_CREDIT_KINDS))
    ) or 0
    debits = await db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount_cents), 0))
        .where(LedgerEntry.user_id == user_id)
        .where(LedgerEntry.kind.in_(_DEBIT_KINDS))
    ) or 0
    return int(credits) - int(debits)


async def held_balance_cents(db, user_id) -> int:
    """Winnings still on chargeback hold, in cents.

    A credit is held when it's traceable (via its Win -> QueueEntry -> Payment)
    to a CARD-funded ticket whose charge confirmed less than CHARGEBACK_HOLD_DAYS
    ago. Crypto-funded winnings are never held (irreversible payment in).

    Known gap: credits with no win_id (CARD_RESELL from collection) can't be
    traced to the funding payment and are treated as not held — the direct
    win->resell path (the common vector) is covered.
    """
    threshold = datetime.utcnow() - timedelta(days=CHARGEBACK_HOLD_DAYS)
    held = await db.scalar(
        select(func.coalesce(func.sum(LedgerEntry.amount_cents), 0))
        .select_from(LedgerEntry)
        .join(Win, Win.id == LedgerEntry.win_id)
        .join(Payment, Payment.queue_entry_id == Win.queue_entry_id)
        .where(LedgerEntry.user_id == user_id)
        .where(LedgerEntry.kind.in_(_CREDIT_KINDS))
        .where(Payment.method == PaymentMethod.CARD)
        .where(Payment.confirmed_at.isnot(None))
        .where(Payment.confirmed_at > threshold)
    ) or 0
    return int(held)


async def withdrawable_balance_cents(db, user_id) -> int:
    """Balance the user can withdraw right now: total minus chargeback holds."""
    total = await off_chain_balance_cents(db, user_id)
    held = await held_balance_cents(db, user_id)
    return max(0, total - held)


def place_bet(addr, amount, deadline, sig) -> bool:
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    contract = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)
    owner = w3.eth.account.from_key(PRIVATE_KEY).address
    txn = contract.functions.bet(addr, amount, deadline, sig).build_transaction(
        {
            "from": owner,
            "nonce": w3.eth.get_transaction_count(owner),
            "chainId": CHAIN_ID,
        }
    )
    signed = w3.eth.account.sign_transaction(txn, private_key=PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    if receipt["status"] != 1:
        log.info("Transaction failed")
        return False, None

    logs = contract.events.PlayerBet().process_receipt(receipt)
    if logs:
        key = logs[0]["args"]["key"]
        log.info(f"Key emitted:{key.hex()}")
        return True, key
    else:
        log.info("No event found")
        return False, None


async def safe_place_bet(loop, *args):
    for attempt in range(3):
        try:
            return await loop.run_in_executor(None, place_bet, *args)
        except (requests.exceptions.RequestException, ConnectionResetError) as e:
            log.warning("RPC error: %s (retry %s/3)", e, attempt + 1)
            await asyncio.sleep(1.5**attempt)
        except Exception as e:
            log.warning("Unexpected error placing bet")
            return False, None
    return False, None


def verify_usdc_transfer(tx_hash, from_addr, min_base_units) -> bool:
    """Crypto-rail payment check: confirm `tx_hash` is a succeeded USDC transfer
    of at least `min_base_units` from `from_addr` to the treasury.

    The frontend pays by transferring USDC straight to the treasury (no escrow
    permit/bet) and hands us the tx hash; we verify the on-chain receipt.
    """
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    receipt = w3.eth.get_transaction_receipt(tx_hash)
    if receipt["status"] != 1:
        return False

    token_addr   = Web3.to_checksum_address(USDC_TOKEN_ADDRESS)
    treasury     = Web3.to_checksum_address(TREASURY_ADDRESS)
    sender       = Web3.to_checksum_address(from_addr)
    token        = w3.eth.contract(address=token_addr, abi=erc20_abi)

    for lg in token.events.Transfer().process_receipt(receipt):
        # process_receipt can surface Transfer logs from other contracts that
        # share the topic, so pin the emitting address to USDC.
        if Web3.to_checksum_address(lg["address"]) != token_addr:
            continue
        a = lg["args"]
        if (Web3.to_checksum_address(a["from"]) == sender
                and Web3.to_checksum_address(a["to"]) == treasury
                and a["value"] >= min_base_units):
            return True
    return False


async def safe_verify_usdc_transfer(loop, *args) -> bool:
    for attempt in range(3):
        try:
            return await loop.run_in_executor(None, verify_usdc_transfer, *args)
        except (requests.exceptions.RequestException, ConnectionResetError) as e:
            log.warning("RPC error verifying transfer: %s (retry %s/3)", e, attempt + 1)
            await asyncio.sleep(1.5**attempt)
        except Exception:
            log.exception("Unexpected error verifying USDC transfer")
            return False
    return False


def send_usdc(to_addr, base_units):
    """Send USDC from the treasury to `to_addr` (a winnings payout / withdrawal).

    Replaces the retired contract `withdrawFull` — the treasury now holds funds
    and pays out directly. Returns (ok, tx_hash_hex).
    """
    w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP))
    token = w3.eth.contract(address=Web3.to_checksum_address(USDC_TOKEN_ADDRESS), abi=erc20_abi)
    acct = w3.eth.account.from_key(TREASURY_PRIVATE_KEY)

    txn = token.functions.transfer(
        Web3.to_checksum_address(to_addr), int(base_units)
    ).build_transaction({
        "from": acct.address,
        "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
        "chainId": CHAIN_ID,
    })
    signed = w3.eth.account.sign_transaction(txn, private_key=TREASURY_PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    if receipt["status"] != 1:
        return False, None
    return True, tx_hash.hex()


async def safe_send_usdc(loop, *args):
    for attempt in range(3):
        try:
            return await loop.run_in_executor(None, send_usdc, *args)
        except (requests.exceptions.RequestException, ConnectionResetError) as e:
            log.warning("RPC error sending USDC: %s (retry %s/3)", e, attempt + 1)
            await asyncio.sleep(1.5**attempt)
        except Exception:
            log.exception("Unexpected error sending USDC payout")
            return False, None
    return False, None


def cents_to_usdc_base_units(cents: int) -> int:
    return int(cents) * (10 ** USDC_DECIMALS) // 100


async def user_account_data(addr, db):
    # Balance is off-chain now (contract retired): the withdrawable winnings
    # ledger, summed. Returned in dollars for the UI ($<balance>).
    user = await db.scalar(select(User).where(User.wallet_address == addr))
    balance_cents = await off_chain_balance_cents(db, user.id) if user else 0
    balance = balance_cents / 100
    bets_mappings = await db.execute(
        select(
            QueueEntry.bet.label("bet"),
            QueueEntry.win.label("win"),
            QueueEntry.played_at.label("played_at"),
            Round.multiplier.label("multiplier"),
        )
        .join(QueueEntry.round)
        .where(QueueEntry.address == addr, QueueEntry.status == "played")
        .order_by(QueueEntry.played_at.desc())
    )

    bets = [
        {
            "bet": r["bet"],
            "win": r["win"],
            "played_at": int(r["played_at"].timestamp()),
            "multiplier": r["multiplier"],
        }
        for r in bets_mappings.mappings().all()
    ]

    withdrawals_mappings = await db.execute(
        select(
            Withdrawal.amount.label("amount"),
            Withdrawal.timestamp.label("timestamp"),
        )
        .where(Withdrawal.address == addr)
        .order_by(Withdrawal.timestamp.desc())
    )

    withdrawals = [
        {
            # Withdrawal.amount is stored in cents; surface dollars to match the
            # balance the UI renders as $<value>.
            "amount": r["amount"] / 100,
            "timestamp": int(r["timestamp"].timestamp()),
        }
        for r in withdrawals_mappings.mappings().all()
    ]

    return balance, bets, withdrawals
