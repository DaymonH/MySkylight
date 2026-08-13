"""Unit tests for Clerk JWT verification (`app.core.security.verify_clerk_token`).

The suite-wide `patch_clerk_verify` autouse fixture (conftest) bypasses JWKS so the
HTTP-level tests can authenticate freely. Here we want the *real* verifier, so we
shadow that fixture with a no-op and drive `verify_clerk_token` directly — signing
tokens with a locally-generated RSA keypair that stands in for Clerk's JWKS.
"""

import datetime as dt
from unittest.mock import MagicMock, patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from starlette.requests import Request

from app.core.security import hash_pin, verify_clerk_token, verify_pin


@pytest.fixture(autouse=True)
def patch_clerk_verify():
    """Shadow the conftest autouse patch — these tests exercise the real verifier."""
    yield


@pytest.fixture(scope="module")
def keypair():
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return priv, priv.public_key()


def _make_request(headers: dict[str, str]) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw})


def _future() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)


def _bearer(token: str) -> Request:
    return _make_request({"Authorization": f"Bearer {token}"})


def _with_jwks(public_key):
    """Patch the module JWKS client so `get_signing_key_from_jwt` yields our key."""
    cm = patch("app.core.security._jwks_client")
    jwks = cm.start()
    jwks.get_signing_key_from_jwt.return_value = MagicMock(key=public_key)
    return cm


async def test_valid_token_returns_subject(keypair):
    priv, pub = keypair
    token = jwt.encode({"sub": "user_abc123", "exp": _future()}, priv, algorithm="RS256")
    cm = _with_jwks(pub)
    try:
        sub = await verify_clerk_token(_bearer(token))
    finally:
        cm.stop()
    assert sub == "user_abc123"


async def test_missing_authorization_header_is_401():
    with pytest.raises(HTTPException) as exc:
        await verify_clerk_token(_make_request({}))
    assert exc.value.status_code == 401
    assert "Authorization" in exc.value.detail


async def test_malformed_authorization_header_is_401():
    # Present but not a Bearer scheme.
    with pytest.raises(HTTPException) as exc:
        await verify_clerk_token(_make_request({"Authorization": "Token deadbeef"}))
    assert exc.value.status_code == 401


async def test_expired_token_is_401(keypair):
    priv, pub = keypair
    expired = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
    token = jwt.encode({"sub": "user_x", "exp": expired}, priv, algorithm="RS256")
    cm = _with_jwks(pub)
    try:
        with pytest.raises(HTTPException) as exc:
            await verify_clerk_token(_bearer(token))
    finally:
        cm.stop()
    assert exc.value.status_code == 401
    assert exc.value.detail == "Token has expired"


async def test_token_signed_by_wrong_key_is_invalid(keypair):
    priv, _pub = keypair
    other_pub = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key()
    token = jwt.encode({"sub": "user_x", "exp": _future()}, priv, algorithm="RS256")
    # JWKS hands back a key that did NOT sign the token → signature check fails.
    cm = _with_jwks(other_pub)
    try:
        with pytest.raises(HTTPException) as exc:
            await verify_clerk_token(_bearer(token))
    finally:
        cm.stop()
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


async def test_unknown_signing_key_is_invalid(keypair):
    # JWKS lookup itself fails (e.g. the token's `kid` isn't in the set).
    cm = patch("app.core.security._jwks_client")
    jwks = cm.start()
    jwks.get_signing_key_from_jwt.side_effect = Exception("no matching key")
    try:
        with pytest.raises(HTTPException) as exc:
            await verify_clerk_token(_bearer("ey.not.a.real.token"))
    finally:
        cm.stop()
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


async def test_token_without_subject_is_401(keypair):
    priv, pub = keypair
    token = jwt.encode({"exp": _future()}, priv, algorithm="RS256")  # no `sub`
    cm = _with_jwks(pub)
    try:
        with pytest.raises(HTTPException) as exc:
            await verify_clerk_token(_bearer(token))
    finally:
        cm.stop()
    assert exc.value.status_code == 401
    assert exc.value.detail == "Token missing subject"


def test_pin_hash_is_deterministic_and_verifies():
    h = hash_pin("1234")
    assert h == hash_pin("1234")  # stable for the same pepper + pin
    assert verify_pin("1234", h)
    assert not verify_pin("0000", h)
