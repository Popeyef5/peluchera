"""Supabase JWT verification for admin endpoints.

We trust Supabase to manage admin identity (sign-up disabled in the dashboard,
manual invites only — see central/next-admin/.env.admin.example). Every admin
request must carry a valid JWT issued by our project.

Newer Supabase projects sign tokens with asymmetric keys (ES256 / RS256) and
publish the public JWKS at `<project>/auth/v1/.well-known/jwks.json`. Older
projects use a shared HS256 secret. We support both — JWKS preferred, HS256
as a legacy fallback.

There's no AdminUser table in v1: the JWT *is* the identity. The decoded
payload (sub, email, role) is attached to the request via the `current_admin`
dependency for handlers that want to log who did what.
"""

from typing import Optional, TypedDict
import jwt
from jwt import PyJWKClient
from fastapi import Depends, Header, HTTPException, status

from ..config import SUPABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_JWT_AUDIENCE
from ..logging import log


class AdminIdentity(TypedDict):
	sub: str
	email: Optional[str]
	role: Optional[str]


# Lazily built so SUPABASE_URL being unset (dev w/o admin) doesn't fail the
# whole app at import time. PyJWKClient caches fetched keys and re-fetches
# on cache miss (e.g., after Supabase rotates the signing key).
_jwks_client: Optional[PyJWKClient] = None


def _get_jwks_client() -> Optional[PyJWKClient]:
	global _jwks_client
	if _jwks_client is not None:
		return _jwks_client
	if not SUPABASE_URL:
		return None
	url = SUPABASE_URL.rstrip("/") + "/auth/v1/.well-known/jwks.json"
	_jwks_client = PyJWKClient(url, cache_keys=True)
	return _jwks_client


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
	"""Verify with JWKS (asymmetric, preferred) or HS256 (legacy fallback).

	Algorithm allow-list is tied to the key type to defend against algorithm-
	confusion attacks — we never accept HS256 when JWKS is configured.
	"""
	jwks = _get_jwks_client()
	if jwks is not None:
		signing_key = jwks.get_signing_key_from_jwt(token).key
		return jwt.decode(
			token,
			signing_key,
			algorithms=["ES256", "RS256"],
			audience=SUPABASE_JWT_AUDIENCE,
		)
	if SUPABASE_JWT_SECRET:
		return jwt.decode(
			token,
			SUPABASE_JWT_SECRET,
			algorithms=["HS256"],
			audience=SUPABASE_JWT_AUDIENCE,
		)
	log.error("Admin auth not configured: set SUPABASE_URL (preferred) or SUPABASE_JWT_SECRET")
	raise HTTPException(
		status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
		detail="Admin auth not configured",
	)


async def current_admin(
	authorization: Optional[str] = Header(default=None),
) -> AdminIdentity:
	"""FastAPI dependency: verify the Supabase JWT on the request.

	401s on missing/invalid/expired tokens. Returns the decoded admin
	identity on success.
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

	return AdminIdentity(
		sub=payload.get("sub", ""),
		email=payload.get("email"),
		role=payload.get("role"),
	)


RequireAdmin = Depends(current_admin)
