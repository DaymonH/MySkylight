from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.deps import CurrentUser
from app.models.family import Family, Membership
from app.schemas.family import MembershipOut
from app.schemas.user import UserOut

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserOut)
async def get_me(current_user: CurrentUser) -> UserOut:
    return UserOut.model_validate(current_user)


@router.get("/memberships", response_model=list[MembershipOut])
async def get_my_memberships(
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> list[MembershipOut]:
    result = await session.execute(
        select(Membership)
        .join(Family, Family.id == Membership.family_id)
        .where(
            Membership.user_id == current_user.id,
            Family.deleted_at.is_(None),
        )
    )
    return [MembershipOut.model_validate(m) for m in result.scalars()]
