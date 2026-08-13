"""Member-persona helpers.

A ``User`` is a Clerk login; a ``Member`` is the calendar persona shown on the
calendar. Each ``User`` in a family should have exactly one ``Member`` (FEATURES
F13). This module owns the idempotent "make sure that persona exists" logic so
family creation and invitation-accept can share it.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.family import Member
from app.models.user import User

# Friendly, distinct defaults so auto-provisioned personas don't all share one
# colour (F02 — each member should be visually distinguishable everywhere).
_MEMBER_PALETTE = [
    "#6366f1", "#ec4899", "#f59e0b", "#10b981",
    "#3b82f6", "#ef4444", "#8b5cf6", "#14b8a6",
]


def _display_name(user: User) -> str:
    parts = [p.strip() for p in (user.first_name, user.last_name) if p and p.strip()]
    name = " ".join(parts) or user.email.split("@")[0]
    return name[:100]


async def ensure_member_for_user(
    user: User,
    family_id: uuid.UUID,
    session: AsyncSession,
    *,
    is_child: bool = False,
) -> tuple[Member, bool]:
    """Return this user's persona in the family, creating one if absent.

    Idempotent: a user has at most one non-deleted ``Member`` per family. Returns
    ``(member, created)`` so callers can decide whether to emit realtime events.
    The new persona is seeded from the user's Clerk profile (name, avatar) and
    given the next colour in the palette; users customise it later via PATCH.
    """
    existing = await session.execute(
        select(Member).where(
            Member.family_id == family_id,
            Member.user_id == user.id,
            Member.deleted_at.is_(None),
        )
    )
    member = existing.scalar_one_or_none()
    if member is not None:
        return member, False

    count = await session.scalar(
        select(func.count()).select_from(Member).where(Member.family_id == family_id)
    ) or 0
    member = Member(
        family_id=family_id,
        user_id=user.id,
        name=_display_name(user),
        color=_MEMBER_PALETTE[count % len(_MEMBER_PALETTE)],
        avatar_url=user.image_url,
        is_child=is_child,
    )
    session.add(member)
    await session.flush()
    return member, True
