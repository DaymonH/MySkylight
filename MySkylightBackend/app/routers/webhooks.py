"""Clerk webhook handler — syncs user lifecycle events into our User table."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from svix.webhooks import Webhook, WebhookVerificationError

from app.core.config import settings
from app.core.database import get_session
from app.models.user import User

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def _upsert_user(session: AsyncSession, data: dict) -> None:
    clerk_id: str = data["id"]
    email_objects = data.get("email_addresses", [])
    primary_email_id = data.get("primary_email_address_id")
    email = ""
    for addr in email_objects:
        if addr.get("id") == primary_email_id:
            email = addr.get("email_address", "")
            break

    result = await session.execute(select(User).where(User.clerk_user_id == clerk_id))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(clerk_user_id=clerk_id, email=email)
        session.add(user)
    else:
        user.email = email or user.email

    user.first_name = data.get("first_name")
    user.last_name = data.get("last_name")
    user.image_url = data.get("image_url")
    user.deleted_at = None

    await session.commit()


async def _soft_delete_user(session: AsyncSession, clerk_id: str) -> None:
    from datetime import datetime, timezone

    result = await session.execute(select(User).where(User.clerk_user_id == clerk_id))
    user = result.scalar_one_or_none()
    if user:
        user.deleted_at = datetime.now(timezone.utc)
        await session.commit()


@router.post("/clerk")
async def clerk_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    payload = await request.body()
    headers = dict(request.headers)

    wh = Webhook(settings.clerk_webhook_secret)
    try:
        event = wh.verify(payload, headers)
    except (WebhookVerificationError, ValueError):
        # ValueError covers a malformed (non-base64) signature header, which Svix
        # surfaces as binascii.Error — still untrusted input, so reject (not 500).
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    event_type: str = event.get("type", "")
    data: dict = event.get("data", {})

    if event_type in ("user.created", "user.updated"):
        await _upsert_user(session, data)
    elif event_type == "user.deleted":
        await _soft_delete_user(session, data.get("id", ""))

    return {"received": True}
