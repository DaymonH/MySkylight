"""FastAPI dependency functions for auth and family-scoped authorization."""

import uuid
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.core.security import verify_clerk_token
from app.models.family import Family, Membership, MembershipRole
from app.models.user import User

# ── Auth ─────────────────────────────────────────────────────────────────────

ClerkUserID = Annotated[str, Depends(verify_clerk_token)]


async def _jit_provision(clerk_user_id: str, session: AsyncSession) -> User:
    """Fetch user details from Clerk API and create a local User row."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="User not found in Clerk")

    data = resp.json()
    primary_id = data.get("primary_email_address_id")
    email = next(
        (a["email_address"] for a in data.get("email_addresses", []) if a.get("id") == primary_id),
        "",
    )
    user = User(
        clerk_user_id=clerk_user_id,
        email=email,
        first_name=data.get("first_name"),
        last_name=data.get("last_name"),
        image_url=data.get("image_url"),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def get_current_user(
    clerk_user_id: ClerkUserID,
    session: AsyncSession = Depends(get_session),
) -> User:
    """Resolve a verified Clerk user ID to our local User row, creating it on first touch."""
    result = await session.execute(
        select(User).where(User.clerk_user_id == clerk_user_id, User.deleted_at.is_(None))
    )
    user = result.scalar_one_or_none()
    if user is None:
        user = await _jit_provision(clerk_user_id, session)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]

# ── Family authorization ──────────────────────────────────────────────────────


async def _require_membership(
    family_id: uuid.UUID,
    user: User,
    session: AsyncSession,
) -> tuple[Family, Membership]:
    result = await session.execute(
        select(Membership, Family)
        .join(Family, Family.id == Membership.family_id)
        .where(
            Membership.user_id == user.id,
            Membership.family_id == family_id,
            Family.deleted_at.is_(None),
        )
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=403, detail="Not a member of this family")
    membership, family = row
    return family, membership


def require_family_role(*allowed_roles: MembershipRole):
    """Returns a dependency that asserts the current user has one of the given roles."""

    async def _dep(
        family_id: uuid.UUID,
        current_user: CurrentUser,
        session: AsyncSession = Depends(get_session),
    ) -> tuple[Family, Membership]:
        family, membership = await _require_membership(family_id, current_user, session)
        if membership.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient role")
        return family, membership

    return _dep


# Pre-built dependency shortcuts
AnyFamilyMember = Annotated[
    tuple[Family, Membership],
    Depends(require_family_role(MembershipRole.owner, MembershipRole.adult, MembershipRole.child, MembershipRole.viewer)),
]

FamilyOwnerOrAdult = Annotated[
    tuple[Family, Membership],
    Depends(require_family_role(MembershipRole.owner, MembershipRole.adult)),
]

FamilyOwnerOnly = Annotated[
    tuple[Family, Membership],
    Depends(require_family_role(MembershipRole.owner)),
]
