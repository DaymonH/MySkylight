import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import hash_pin
from app.deps import AnyFamilyMember, FamilyOwnerOrAdult
from app.models.family import Member
from app.schemas.member import MemberCreate, MemberOut, MemberUpdate
from app.services.realtime import bus

router = APIRouter(prefix="/families/{family_id}/members", tags=["members"])


@router.get("", response_model=list[MemberOut])
async def list_members(
    family_and_membership: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
) -> list[MemberOut]:
    family, _ = family_and_membership
    result = await session.execute(
        select(Member).where(Member.family_id == family.id, Member.deleted_at.is_(None))
    )
    return [MemberOut.model_validate(m) for m in result.scalars()]


@router.post("", response_model=MemberOut, status_code=201)
async def create_member(
    body: MemberCreate,
    family_and_membership: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
) -> MemberOut:
    family, _ = family_and_membership
    member = Member(
        family_id=family.id,
        name=body.name,
        color=body.color,
        is_child=body.is_child,
        user_id=body.user_id,
        pin_hash=hash_pin(body.pin) if body.pin else None,
    )
    session.add(member)
    await session.commit()
    await session.refresh(member)
    await bus.publish(str(family.id), "member.created", {"id": str(member.id)})
    return MemberOut.model_validate(member)


@router.get("/{member_id}", response_model=MemberOut)
async def get_member(
    member_id: uuid.UUID,
    family_and_membership: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
) -> MemberOut:
    family, _ = family_and_membership
    result = await session.execute(
        select(Member).where(
            Member.id == member_id,
            Member.family_id == family.id,
            Member.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return MemberOut.model_validate(member)


@router.patch("/{member_id}", response_model=MemberOut)
async def update_member(
    member_id: uuid.UUID,
    body: MemberUpdate,
    family_and_membership: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
) -> MemberOut:
    family, _ = family_and_membership
    result = await session.execute(
        select(Member).where(
            Member.id == member_id,
            Member.family_id == family.id,
            Member.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")

    if body.name is not None:
        member.name = body.name
    if body.color is not None:
        member.color = body.color
    if body.avatar_url is not None:
        member.avatar_url = body.avatar_url
    if body.pin is not None:
        member.pin_hash = hash_pin(body.pin)

    await session.commit()
    await session.refresh(member)
    await bus.publish(str(family.id), "member.updated", {"id": str(member.id)})
    return MemberOut.model_validate(member)


@router.delete("/{member_id}", status_code=204)
async def delete_member(
    member_id: uuid.UUID,
    family_and_membership: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
) -> None:
    from datetime import datetime, timezone

    family, _ = family_and_membership
    result = await session.execute(
        select(Member).where(
            Member.id == member_id,
            Member.family_id == family.id,
            Member.deleted_at.is_(None),
        )
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    member.deleted_at = datetime.now(timezone.utc)
    await session.commit()
    await bus.publish(str(family.id), "member.deleted", {"id": str(member_id)})
