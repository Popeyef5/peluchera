"""Player sign-in (SIWX): the socket must only trust an address the player proved.

These run offline. The smart-account path (eth_call to the universal validator)
needs a live RPC and is exercised separately; here it is patched out wherever a
test would otherwise reach it.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from app import player_auth as pa
from app.config import CHAIN_ID
from app.socket import events_queue

from conftest import mk_round


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _message(address, nonce, *, domain="localhost", chain=CHAIN_ID, issued=None,
             expires=None, extra=""):
    now = datetime.now(timezone.utc)
    issued = issued or now
    expires = expires or now + timedelta(minutes=10)
    return (
        f"{domain} wants you to sign in with your Ethereum account:\n"
        f"{address}\n\n"
        f"Sign in to Garra to play and claim your prizes.\n\n"
        f"URI: http://{domain}\n"
        f"Version: 1\n"
        f"Chain ID: {chain}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {_iso(issued)}\n"
        f"Expiration Time: {_iso(expires)}"
        f"{extra}"
    )


def _sign(acct, message):
    return acct.sign_message(encode_defunct(text=message)).signature.hex()


@pytest.fixture
def no_rpc(monkeypatch):
    """Fail loudly if a test would fall through to the smart-account RPC path."""
    class _NoRpc:
        def __init__(self, *a, **k):
            raise AssertionError("unexpected RPC call during an offline test")
    monkeypatch.setattr(pa, "Web3", type("W", (), {
        "HTTPProvider": _NoRpc,
        "to_checksum_address": staticmethod(pa.Web3.to_checksum_address),
        "to_bytes": staticmethod(pa.Web3.to_bytes),
    }))


async def _login(message, signature):
    return await pa.verify_login(message, signature, asyncio.get_running_loop())


# ─── verify_login ────────────────────────────────────────────────────────

async def test_valid_signature_proves_the_address(no_rpc):
    acct = Account.create()
    msg = _message(acct.address, pa.issue_nonce())
    assert await _login(msg, _sign(acct, msg)) == acct.address


async def test_nonce_is_single_use(no_rpc):
    acct = Account.create()
    msg = _message(acct.address, pa.issue_nonce())
    sig = _sign(acct, msg)
    await _login(msg, sig)
    with pytest.raises(pa.AuthError, match="already used"):
        await _login(msg, sig)


async def test_unissued_nonce_is_refused(no_rpc):
    acct = Account.create()
    msg = _message(acct.address, "deadbeefdeadbeef")
    with pytest.raises(pa.AuthError, match="already used"):
        await _login(msg, _sign(acct, msg))


async def test_signature_from_another_wallet_is_refused(monkeypatch):
    # The claimed address is the victim's; the signature is the attacker's.
    # Recovery fails, so verification falls through to the smart-account
    # validator; stub the chain to revert, as it does for a foreign signature.
    monkeypatch.setattr(pa, "Web3", _RevertingWeb3)
    victim, attacker = Account.create(), Account.create()
    msg = _message(victim.address, pa.issue_nonce())
    with pytest.raises(pa.AuthError, match="does not match"):
        await _login(msg, _sign(attacker, msg))


class _RevertingWeb3:
    """Stand-in for Web3 whose eth_call reverts, as the validator does on a bad sig."""
    to_checksum_address = staticmethod(pa.Web3.to_checksum_address)
    to_bytes = staticmethod(pa.Web3.to_bytes)

    @staticmethod
    def HTTPProvider(*a, **k):
        return None

    def __init__(self, *a, **k):
        class _Eth:
            @staticmethod
            def call(_tx):
                raise RuntimeError("execution reverted")
        self.eth = _Eth()


async def test_message_for_another_site_is_refused(no_rpc):
    acct = Account.create()
    msg = _message(acct.address, pa.issue_nonce(), domain="c14ws.com")
    with pytest.raises(pa.AuthError, match="different site"):
        await _login(msg, _sign(acct, msg))


async def test_wrong_network_is_refused(no_rpc):
    acct = Account.create()
    msg = _message(acct.address, pa.issue_nonce(), chain=1)
    with pytest.raises(pa.AuthError, match="wrong network"):
        await _login(msg, _sign(acct, msg))


async def test_expired_message_is_refused(no_rpc):
    acct = Account.create()
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    msg = _message(acct.address, pa.issue_nonce(), issued=past - timedelta(minutes=10), expires=past)
    with pytest.raises(pa.AuthError, match="expired"):
        await _login(msg, _sign(acct, msg))


async def test_one_click_auth_resources_block_is_accepted(no_rpc):
    # WalletConnect one-click auth formats the message itself and appends a
    # Resources list. The parser must tolerate it.
    acct = Account.create()
    extra = "\nResources:\n- urn:recap:eyJhdHQiOnt9fQ"
    msg = _message(acct.address, pa.issue_nonce(), extra=extra)
    assert await _login(msg, _sign(acct, msg)) == acct.address


async def test_malformed_message_is_refused(no_rpc):
    with pytest.raises(pa.AuthError, match="malformed"):
        await _login("hello", "0x00")


# ─── session tokens ──────────────────────────────────────────────────────

def test_session_token_round_trips_lowercased():
    acct = Account.create()
    token = pa.mint_session(acct.address)["token"]
    assert pa.session_address(token) == acct.address.lower()


def test_tampered_or_foreign_tokens_are_rejected():
    import jwt
    acct = Account.create()
    token = pa.mint_session(acct.address)["token"]
    assert pa.session_address(token[:-2] + "xx") is None
    forged = jwt.encode({"sub": acct.address.lower(), "typ": "player"}, "not-our-secret", algorithm="HS256")
    assert pa.session_address(forged) is None
    assert pa.session_address(None) is None


# ─── wallet_connected enforcement ────────────────────────────────────────

@pytest.fixture
def enforced(monkeypatch):
    """Run wallet_connected with enforcement on and no real Socket.IO server."""
    monkeypatch.setattr(events_queue, "BYPASS_PAYMENT", False)
    rooms = {}

    async def enter_room(sid, room, *a, **k):
        rooms[sid] = room

    async def leave_room(sid, room, *a, **k):
        rooms.pop(sid, None)

    monkeypatch.setattr(events_queue.sio, "enter_room", enter_room)
    monkeypatch.setattr(events_queue.sio, "leave_room", leave_room)
    events_queue.sid_to_addr.clear()
    return rooms


async def test_claiming_an_address_without_a_token_binds_nothing(enforced):
    victim = Account.create().address
    res = await events_queue.wallet_connected("sid-1", {"address": victim})
    assert res["code"] == "unauthenticated"
    assert events_queue.sid_to_addr.get("sid-1") is None
    assert "sid-1" not in enforced


async def test_a_token_for_one_address_cannot_claim_another(enforced):
    attacker, victim = Account.create().address, Account.create().address
    token = pa.mint_session(attacker)["token"]
    res = await events_queue.wallet_connected("sid-1", {"address": victim, "token": token})
    assert res["code"] == "unauthenticated"
    assert events_queue.sid_to_addr.get("sid-1") is None


async def test_a_matching_token_binds_the_socket(enforced, db):
    await mk_round(db)
    await db.commit()
    player = Account.create().address
    token = pa.mint_session(player)["token"]
    res = await events_queue.wallet_connected("sid-1", {"address": player, "token": token})
    assert res["status"] == "ok"
    assert events_queue.sid_to_addr["sid-1"] == player
    assert enforced["sid-1"] == player


async def test_a_refused_claim_unbinds_a_previously_bound_socket(enforced, db):
    await mk_round(db)
    await db.commit()
    player, victim = Account.create().address, Account.create().address
    token = pa.mint_session(player)["token"]
    await events_queue.wallet_connected("sid-1", {"address": player, "token": token})
    res = await events_queue.wallet_connected("sid-1", {"address": victim, "token": token})
    assert res["code"] == "unauthenticated"
    assert events_queue.sid_to_addr.get("sid-1") is None
    assert "sid-1" not in enforced
