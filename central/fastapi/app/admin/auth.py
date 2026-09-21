"""Neon Auth JWT verification for admin endpoints.

Operators sign in to the admin panel with Neon Auth (Managed Better Auth on the
production branch): an emailed one-time code or Google. The panel then asks
Neon Auth for a short-lived JWT (EdDSA / Ed25519, 15 minutes) and sends it as
`Authorization: Bearer`. We verify it against the branch's public JWKS at
`<NEON_AUTH_BASE_URL>/.well-known/jwks.json`; issuer and audience are both the
origin of NEON_AUTH_BASE_URL.

A valid token only proves "someone signed in to our Neon Auth". Sign-up there
is open, and email+password sign-up does not check the address, so two more
gates decide who is an operator:
  - the email must be verified (a code or Google proved the inbox), and
  - it must be on ADMIN_EMAIL_ALLOWLIST / ADMIN_EMAIL_DOMAINS.

There's no AdminUser table: the JWT *is* the identity. The decoded payload
(sub, email, role) is attached via the `current_admin` dependency for handlers
that want to log who did what.
"""

from typing import Optional, TypedDict
from urllib.parse import urlsplit

import jwt
from jwt import PyJWKClient
from fastapi import Depends, Header, HTTPException, status

from ..config import NEON_AUTH_BASE_URL, admin_email_allowed
from ..logging import log


class AdminIdentity(TypedDict):
	sub: str
	email: Optional[str]
	role: Optional[str]


# Lazily built so NEON_AUTH_BASE_URL being unset (dev w/o admin) doesn't fail
# the whole app at import time. PyJWKClient caches fetched keys and re-fetches
# on an unknown `kid` (i.e. after Neon rotates the signing key).
_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> Optional[PyJWKClient]:
	global _jwks_client
	if _jwks_client is not None:
		return _jwks_client
	if not NEON_AUTH_BASE_URL:
		return None
	url = NEON_AUTH_BASE_URL.rstrip("/") + "/.well-known/jwks.json"
	_jwks_client = PyJWKClient(url, cache_keys=True)
	return _jwks_client


def _issuer() -> str:
	"""Neon Auth stamps iss and aud with the origin of its base URL (no path)."""
	parts = urlsplit(NEON_AUTH_BASE_URL or "")
	return f"{parts.scheme}://{parts.netloc}"


def _bearer_token(authorization: Optional[str]) -> str:
	if not authorization:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Missing Authorization header",
			headers={"WWW-Authenticate": "Bearer"},
		)
	parts = authorization.split(" ", 1)
	if len(parts) != 2 or parts[0].lower() != "bearer":
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Malformed Authorization header",
			headers={"WWW-Authenticate": "Bearer"},
		)
	return parts[1].strip()


def _verify(token: str) -> dict:
	"""Verify signature, expiry, issuer and audience against Neon Auth's JWKS.

	Only EdDSA is accepted: pinning the algorithm to the key type is what stops
	algorithm-confusion attacks.
	"""
	jwks = _get_jwks_client()
	if jwks is None:
		log.error("Admin auth not configured: set NEON_AUTH_BASE_URL")
		raise HTTPException(
			status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
			detail="Admin auth not configured",
		)
	signing_key = jwks.get_signing_key_from_jwt(token).key
	return jwt.decode(
		token,
		signing_key,
		algorithms=["EdDSA"],
		issuer=_issuer(),
		audience=_issuer(),
		options={"require": ["exp", "iss", "aud", "sub"]},
	)


async def current_admin(
	authorization: Optional[str] = Header(default=None),
) -> AdminIdentity:
	"""FastAPI dependency: verify the Neon Auth JWT on the request.

	401s on missing/invalid/expired tokens, 403s on a valid identity that isn't
	an operator. Returns the decoded admin identity on success.
	"""
	token = _bearer_token(authorization)

	try:
		payload = _verify(token)
	except jwt.ExpiredSignatureError:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Token expired",
			headers={"WWW-Authenticate": "Bearer"},
		)
	except jwt.InvalidTokenError as e:
		log.warning("Rejected admin token: %s", e)
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Invalid token",
			headers={"WWW-Authenticate": "Bearer"},
		)
	except HTTPException:
		raise
	except Exception as e:
		# JWKS fetch failures, network errors, etc. land here.
		log.exception("Admin auth verification error: %s", e)
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Verification failed",
			headers={"WWW-Authenticate": "Bearer"},
		)

	email = payload.get("email")

	# Anyone can create a Neon Auth account with a password for an address they
	# don't own. Only a verified address (code or Google) counts.
	if payload.get("emailVerified") is not True:
		log.warning("Admin access denied for %s — email not verified", email)
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="Sign in with an emailed code or Google to verify this address.",
		)

	# Access gate: a verified identity still has to be an OPERATOR.
	if not admin_email_allowed(email):
		log.warning("Admin access denied for %s — not in ADMIN_EMAIL_ALLOWLIST/DOMAINS", email)
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="This account is not authorized for admin access.",
		)

	return AdminIdentity(
		sub=payload.get("sub", ""),
		email=email,
		role=payload.get("role"),
	)


RequireAdmin = Depends(current_admin)
