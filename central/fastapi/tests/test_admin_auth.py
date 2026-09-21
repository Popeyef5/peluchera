"""Admin tokens: a valid Neon Auth JWT alone is not enough to be an operator."""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException

from app import config
from app.admin import auth

BASE = "https://ep-test.neonauth.example.neon.tech/neondb/auth"
ORIGIN = "https://ep-test.neonauth.example.neon.tech"
OPERATOR = "op@example.com"

_KEY = Ed25519PrivateKey.generate()


class _Jwks:
    """Stands in for PyJWKClient: always hands back our test public key."""
    class _SigningKey:
        key = _KEY.public_key()

    def get_signing_key_from_jwt(self, token):
        return self._SigningKey()


@pytest.fixture(autouse=True)
def _neon_auth(monkeypatch):
    monkeypatch.setattr(auth, "NEON_AUTH_BASE_URL", BASE)
    monkeypatch.setattr(auth, "_get_jwks_client", lambda: _Jwks())
    monkeypatch.setattr(config, "ADMIN_EMAIL_ALLOWLIST", {OPERATOR})
    monkeypatch.setattr(config, "ADMIN_EMAIL_DOMAINS", set())


def _token(key=_KEY, algorithm="EdDSA", **overrides):
    now = int(time.time())
    claims = {
        "sub": "user-1", "email": OPERATOR, "emailVerified": True,
        "role": "authenticated", "iss": ORIGIN, "aud": ORIGIN,
        "iat": now, "exp": now + 900,
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm=algorithm)


async def _admin(token):
    return await auth.current_admin(authorization=f"Bearer {token}")


async def _status(token):
    with pytest.raises(HTTPException) as e:
        await _admin(token)
    return e.value.status_code


async def test_verified_operator_gets_in():
    who = await _admin(_token())
    assert who["email"] == OPERATOR
    assert who["sub"] == "user-1"


async def test_allowlist_ignores_email_case():
    who = await _admin(_token(email="Op@Example.com"))
    assert who["email"] == "Op@Example.com"


async def test_unverified_email_is_refused():
    # Password sign-up is open and doesn't check the inbox: anyone could claim
    # an operator's address that way.
    assert await _status(_token(emailVerified=False)) == 403


async def test_missing_verified_claim_is_refused():
    assert await _status(_token(emailVerified=None)) == 403


async def test_stranger_is_refused():
    assert await _status(_token(email="someone@else.com")) == 403


async def test_empty_allowlist_admits_nobody(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAIL_ALLOWLIST", set())
    assert await _status(_token()) == 403


async def test_domain_allowlist(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAIL_ALLOWLIST", set())
    monkeypatch.setattr(config, "ADMIN_EMAIL_DOMAINS", {"cl4ws.com"})
    assert (await _admin(_token(email="ops@cl4ws.com")))["email"] == "ops@cl4ws.com"
    assert await _status(_token(email="ops@cl4ws.com.evil")) == 403


async def test_token_from_another_neon_auth_is_refused():
    other = "https://ep-other.neonauth.example.neon.tech"
    assert await _status(_token(iss=other, aud=other)) == 401


async def test_wrong_audience_is_refused():
    assert await _status(_token(aud="https://elsewhere.example")) == 401


async def test_foreign_signing_key_is_refused():
    assert await _status(_token(key=Ed25519PrivateKey.generate())) == 401


async def test_symmetric_token_is_refused():
    # Algorithm confusion: an HS256 token must never verify.
    assert await _status(_token(key="x" * 32, algorithm="HS256")) == 401


async def test_expired_token_is_refused():
    with pytest.raises(HTTPException) as e:
        await _admin(_token(exp=int(time.time()) - 60))
    assert e.value.status_code == 401
    assert e.value.detail == "Token expired"


async def test_missing_header_is_refused():
    with pytest.raises(HTTPException) as e:
        await auth.current_admin(authorization=None)
    assert e.value.status_code == 401


async def test_unconfigured_is_503(monkeypatch):
    monkeypatch.setattr(auth, "NEON_AUTH_BASE_URL", None)
    monkeypatch.setattr(auth, "_get_jwks_client", lambda: None)
    assert await _status(_token()) == 503


def test_issuer_is_the_base_url_origin():
    assert auth._issuer() == ORIGIN
