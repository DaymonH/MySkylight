"""Tests for the Clerk webhook user-sync handler (`app/routers/webhooks.py`).

The handler verifies a Svix signature, then upserts / soft-deletes the local `User`.
We sign payloads with the *same* secret the app verifies against (`whsec_test` from
the pytest env) so the real Svix verification path runs end-to-end.
"""

import base64
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from svix.webhooks import Webhook

from app.core.config import settings
from app.models.user import User

WEBHOOK_URL = "/api/v1/webhooks/clerk"


@pytest.fixture(autouse=True)
def patch_clerk_verify():
    """The webhook authenticates via Svix, not a Clerk JWT — skip the conftest patch."""
    yield


def _signed(body: dict) -> tuple[str, dict[str, str]]:
    """Return (raw_payload, headers) carrying a valid Svix signature."""
    payload = json.dumps(body)
    wh = Webhook(settings.clerk_webhook_secret)
    msg_id = "msg_test_1"
    ts = datetime.now(timezone.utc)
    signature = wh.sign(msg_id, ts, payload)
    headers = {
        "svix-id": msg_id,
        "svix-timestamp": str(int(ts.timestamp())),
        "svix-signature": signature,
    }
    return payload, headers


def _user_event(event_type: str, clerk_id: str, **over) -> dict:
    data = {
        "id": clerk_id,
        "first_name": over.get("first_name", "Web"),
        "last_name": over.get("last_name", "Hook"),
        "image_url": over.get("image_url"),
        "primary_email_address_id": "em_1",
        "email_addresses": [
            {"id": "em_1", "email_address": over.get("email", "web@hook.test")}
        ],
    }
    return {"type": event_type, "data": data}


async def _fetch(session, clerk_id: str) -> User:
    # populate_existing → re-read fresh; the handler committed on a different session.
    return (
        await session.execute(
            select(User)
            .where(User.clerk_user_id == clerk_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def test_user_created_inserts_user(client, session):
    payload, headers = _signed(
        _user_event("user.created", "user_hook_1", email="alice@hook.test", first_name="Alice")
    )
    resp = await client.post(WEBHOOK_URL, content=payload, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"received": True}

    user = await _fetch(session, "user_hook_1")
    assert user.email == "alice@hook.test"
    assert user.first_name == "Alice"
    assert user.deleted_at is None


async def test_user_updated_updates_existing(client, session):
    session.add(User(clerk_user_id="user_hook_2", email="old@hook.test", first_name="Old"))
    await session.commit()

    payload, headers = _signed(
        _user_event("user.updated", "user_hook_2", email="new@hook.test", first_name="New")
    )
    resp = await client.post(WEBHOOK_URL, content=payload, headers=headers)
    assert resp.status_code == 200

    user = await _fetch(session, "user_hook_2")
    assert user.email == "new@hook.test"
    assert user.first_name == "New"


async def test_user_deleted_soft_deletes(client, session):
    session.add(User(clerk_user_id="user_hook_3", email="bye@hook.test"))
    await session.commit()

    payload, headers = _signed({"type": "user.deleted", "data": {"id": "user_hook_3"}})
    resp = await client.post(WEBHOOK_URL, content=payload, headers=headers)
    assert resp.status_code == 200

    user = await _fetch(session, "user_hook_3")
    assert user.deleted_at is not None


@pytest.mark.parametrize(
    "bad_signature",
    [
        "v1,not-a-real-signature",  # not valid base64 (would 500 if unguarded)
        "v1," + base64.b64encode(b"wrong-hmac").decode(),  # valid base64, wrong HMAC
    ],
)
async def test_invalid_signature_is_rejected(client, bad_signature):
    body = {"type": "user.created", "data": {"id": "user_hook_x", "email_addresses": []}}
    headers = {
        "svix-id": "msg_bad",
        "svix-timestamp": str(int(datetime.now(timezone.utc).timestamp())),
        "svix-signature": bad_signature,
    }
    resp = await client.post(WEBHOOK_URL, content=json.dumps(body), headers=headers)
    assert resp.status_code == 400
