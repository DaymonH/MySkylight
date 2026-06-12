"""Clerk JWT verification and child PIN hashing."""

import hashlib
import hmac

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from app.core.config import settings

# PyJWT's PyJWKClient fetches + caches Clerk's JWKS automatically
_jwks_client = PyJWKClient(settings.clerk_jwks_url, cache_jwk_set=True, lifespan=3600)


async def verify_clerk_token(request: Request) -> str:
    """Parse the Bearer token from the request and return the Clerk user ID (sub claim)."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")

    token = auth_header.removeprefix("Bearer ").strip()
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    clerk_user_id: str | None = payload.get("sub")
    if not clerk_user_id:
        raise HTTPException(status_code=401, detail="Token missing subject")
    return clerk_user_id


def hash_pin(pin: str) -> str:
    """HMAC-SHA256 the PIN with the app pepper. Returns a hex digest."""
    return hmac.new(
        settings.pin_pepper.encode(),
        pin.encode(),
        hashlib.sha256,
    ).hexdigest()


def verify_pin(pin: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_pin(pin), stored_hash)
