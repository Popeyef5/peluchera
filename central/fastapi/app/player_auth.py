"""Player sign-in: prove a wallet address before the socket trusts it.

Before this, the player's identity was whatever address the browser reported in
`wallet_connected`. Anyone could claim anyone, then settle or ship their prizes.

Flow (Reown SIWX on the client, see next/lib/wallet/siwx.ts):
  1. `auth_nonce`   server issues a single-use nonce.
  2. The wallet signs an EIP-4361 "Sign-In with Ethereum" message containing it.
  3. `auth_verify`  server parses the message, checks domain, chain, nonce and
                      timestamps, verifies the signature, and returns a session
                      token signed with PLAYER_SESSION_SECRET.
  4. `wallet_connected` binds an address to the socket only if the token names
                      that same address.

Signatures are verified two ways, mirroring viem's verifyHash:
  - plain accounts: ECDSA recovery, locally, no network;
  - smart accounts: an eth_call that runs the ERC-6492 universal signature
    validator, which covers deployed contracts (EIP-1271) and not-yet-deployed
    ones (ERC-6492). Reown's email and social logins provision smart accounts,
    so recovery alone would lock those players out.
"""
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

import jwt
from eth_abi import encode as abi_encode
from eth_account import Account
from eth_account.messages import defunct_hash_message, encode_defunct
from web3 import Web3

from .config import BASE_RPC_HTTP, CHAIN_ID, PLAYER_AUTH_DOMAINS, PLAYER_SESSION_SECRET
from .logging import log

NONCE_TTL_SEC = 10 * 60
SESSION_DAYS = 30
# Tolerance for a client clock that runs a little ahead of ours.
CLOCK_SKEW_SEC = 5 * 60

if PLAYER_SESSION_SECRET:
    _SECRET = PLAYER_SESSION_SECRET
else:
    _SECRET = secrets.token_hex(32)
    log.warning(
        "PLAYER_SESSION_SECRET is not set — using a random per-process secret. "
        "Every player will have to sign in again after each restart."
    )

# Copied verbatim from viem (viem/_esm/constants/contracts.js,
# universalSignatureValidatorByteCode, viem 2.23.2). Executed as deployless
# eth_call: the constructor validates (signer, hash, signature) and returns a bool.
UNIVERSAL_SIG_VALIDATOR_BYTECODE = "0x608060405234801561001057600080fd5b5060405161069438038061069483398101604081905261002f9161051e565b600061003c848484610048565b9050806000526001601ff35b60007f64926492649264926492649264926492649264926492649264926492649264926100748361040c565b036101e7576000606080848060200190518101906100929190610577565b60405192955090935091506000906001600160a01b038516906100b69085906105dd565b6000604051808303816000865af19150503d80600081146100f3576040519150601f19603f3d011682016040523d82523d6000602084013e6100f8565b606091505b50509050876001600160a01b03163b60000361016057806101605760405162461bcd60e51b815260206004820152601e60248201527f5369676e617475726556616c696461746f723a206465706c6f796d656e74000060448201526064015b60405180910390fd5b604051630b135d3f60e11b808252906001600160a01b038a1690631626ba7e90610190908b9087906004016105f9565b602060405180830381865afa1580156101ad573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906101d19190610633565b6001600160e01b03191614945050505050610405565b6001600160a01b0384163b1561027a57604051630b135d3f60e11b808252906001600160a01b03861690631626ba7e9061022790879087906004016105f9565b602060405180830381865afa158015610244573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102689190610633565b6001600160e01b031916149050610405565b81516041146102df5760405162461bcd60e51b815260206004820152603a602482015260008051602061067483398151915260448201527f3a20696e76616c6964207369676e6174757265206c656e6774680000000000006064820152608401610157565b6102e7610425565b5060208201516040808401518451859392600091859190811061030c5761030c61065d565b016020015160f81c9050601b811480159061032b57508060ff16601c14155b1561038c5760405162461bcd60e51b815260206004820152603b602482015260008051602061067483398151915260448201527f3a20696e76616c6964207369676e617475726520762076616c756500000000006064820152608401610157565b60408051600081526020810180835289905260ff83169181019190915260608101849052608081018390526001600160a01b0389169060019060a0016020604051602081039080840390855afa1580156103ea573d6000803e3d6000fd5b505050602060405103516001600160a01b0316149450505050505b9392505050565b600060208251101561041d57600080fd5b508051015190565b60405180606001604052806003906020820280368337509192915050565b6001600160a01b038116811461045857600080fd5b50565b634e487b7160e01b600052604160045260246000fd5b60005b8381101561048c578181015183820152602001610474565b50506000910152565b600082601f8301126104a657600080fd5b81516001600160401b038111156104bf576104bf61045b565b604051601f8201601f19908116603f011681016001600160401b03811182821017156104ed576104ed61045b565b60405281815283820160200185101561050557600080fd5b610516826020830160208701610471565b949350505050565b60008060006060848603121561053357600080fd5b835161053e81610443565b6020850151604086015191945092506001600160401b0381111561056157600080fd5b61056d86828701610495565b9150509250925092565b60008060006060848603121561058c57600080fd5b835161059781610443565b60208501519093506001600160401b038111156105b357600080fd5b6105bf86828701610495565b604086015190935090506001600160401b0381111561056157600080fd5b600082516105ef818460208701610471565b9190910192915050565b828152604060208201526000825180604084015261061e816060850160208701610471565b601f01601f1916919091016060019392505050565b60006020828403121561064557600080fd5b81516001600160e01b03198116811461040557600080fd5b634e487b7160e01b600052603260045260246000fdfe5369676e617475726556616c696461746f72237265636f7665725369676e6572"


class AuthError(Exception):
    """A sign-in that must be refused. The message is safe to show the player."""


# ─── Nonces ──────────────────────────────────────────────────────────────

_nonces: Dict[str, float] = {}


def issue_nonce() -> str:
    now = time.time()
    for n, exp in list(_nonces.items()):
        if exp <= now:
            _nonces.pop(n, None)
    # EIP-4361 requires at least 8 alphanumeric characters.
    nonce = secrets.token_hex(16)
    _nonces[nonce] = now + NONCE_TTL_SEC
    return nonce


def consume_nonce(nonce: str) -> bool:
    """True exactly once per issued, unexpired nonce."""
    exp = _nonces.pop(nonce, None)
    return exp is not None and exp > time.time()


# ─── EIP-4361 message ────────────────────────────────────────────────────

_HEADER = re.compile(
    r"^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?P<domain>[^\s/]+) wants you to sign in with your Ethereum account:$"
)
_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
_FIELD = re.compile(r"^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time|Not Before|Request ID): (.+)$")


def parse_message(message: str) -> dict:
    """Parse the fields we check out of an EIP-4361 message.

    Tolerant of what we don't check: a statement, and the Resources list that
    WalletConnect one-click auth adds. The wallet formats that variant itself.
    """
    lines = message.split("\n")
    if len(lines) < 2:
        raise AuthError("Sign-in message is malformed.")
    header = _HEADER.match(lines[0].strip())
    if not header or not _ADDRESS.match(lines[1].strip()):
        raise AuthError("Sign-in message is malformed.")
    fields = {"domain": header.group("domain").lower(), "address": lines[1].strip()}
    for line in lines[2:]:
        m = _FIELD.match(line.strip())
        if m and m.group(1) not in fields:
            fields[m.group(1)] = m.group(2).strip()
    for required in ("URI", "Version", "Chain ID", "Nonce", "Issued At"):
        if required not in fields:
            raise AuthError("Sign-in message is missing %s." % required)
    return fields


def _parse_time(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise AuthError("Sign-in message has an unreadable timestamp.")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ─── Signatures ──────────────────────────────────────────────────────────

def verify_signature(address: str, message: str, signature: str) -> bool:
    """Blocking. Plain accounts locally, smart accounts via the validator."""
    try:
        recovered = Account.recover_message(encode_defunct(text=message), signature=signature)
        if recovered.lower() == address.lower():
            return True
    except Exception:
        pass  # not an ordinary 65-byte signature — likely a smart account

    try:
        w3 = Web3(Web3.HTTPProvider(BASE_RPC_HTTP, request_kwargs={"timeout": 15}))
        msg_hash = defunct_hash_message(text=message)
        args = abi_encode(
            ["address", "bytes32", "bytes"],
            [Web3.to_checksum_address(address), bytes(msg_hash), Web3.to_bytes(hexstr=signature)],
        )
        data = UNIVERSAL_SIG_VALIDATOR_BYTECODE + args.hex()
        result = w3.eth.call({"data": data})
        return int.from_bytes(bytes(result), "big") == 1
    except Exception as e:
        # A revert means the validator rejected it; anything else is RPC trouble.
        log.info("smart-account signature check failed for %s: %s", address, e)
        return False


async def verify_login(message: str, signature: str, loop) -> str:
    """Validate a signed sign-in message. Returns the proven address."""
    if not message or not signature:
        raise AuthError("Missing sign-in message or signature.")
    f = parse_message(message)

    if f["domain"] not in PLAYER_AUTH_DOMAINS:
        log.warning("sign-in refused: domain %r not in PLAYER_AUTH_DOMAINS", f["domain"])
        raise AuthError("This sign-in was requested by a different site.")
    if f["Version"] != "1":
        raise AuthError("Unsupported sign-in message version.")
    if str(f["Chain ID"]) != str(CHAIN_ID):
        raise AuthError("Sign-in is for the wrong network.")

    now = datetime.now(timezone.utc)
    if _parse_time(f["Issued At"]) > now + timedelta(seconds=CLOCK_SKEW_SEC):
        raise AuthError("Sign-in message is dated in the future.")
    if "Expiration Time" in f and _parse_time(f["Expiration Time"]) <= now:
        raise AuthError("Sign-in message has expired. Try again.")
    if "Not Before" in f and _parse_time(f["Not Before"]) > now + timedelta(seconds=CLOCK_SKEW_SEC):
        raise AuthError("Sign-in message is not valid yet.")

    # Burn the nonce before the signature check, so a failed attempt cannot be
    # retried against the same nonce.
    if not consume_nonce(f["Nonce"]):
        raise AuthError("Sign-in request expired or was already used. Try again.")

    ok = await loop.run_in_executor(None, verify_signature, f["address"], message, signature)
    if not ok:
        raise AuthError("Signature does not match the wallet address.")
    return Web3.to_checksum_address(f["address"])


# ─── Session tokens ──────────────────────────────────────────────────────

def mint_session(address: str) -> dict:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(days=SESSION_DAYS)
    token = jwt.encode(
        {"sub": address.lower(), "typ": "player", "iat": now, "exp": exp},
        _SECRET,
        algorithm="HS256",
    )
    return {"token": token, "expires_at": int(exp.timestamp())}


def session_address(token: Optional[str]) -> Optional[str]:
    """Lower-cased address a valid session token names, or None."""
    if not token:
        return None
    try:
        claims = jwt.decode(token, _SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if claims.get("typ") != "player":
        return None
    return claims.get("sub")
