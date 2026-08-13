from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.security import hash_pin, verify_pin
from app.deps import AnyFamilyMember, CurrentUser, FamilyOwnerOnly, FamilyOwnerOrAdult
from app.models.family import Family, Membership, MembershipRole
from app.schemas.family import FamilyCreate, FamilyOut, FamilyUpdate, LockUpdate, MembershipOut, PinVerify
from app.services.members import ensure_member_for_user
from app.services.realtime import bus

router = APIRouter(prefix="/families", tags=["families"])


@router.post("", response_model=FamilyOut, status_code=201)
async def create_family(
    body: FamilyCreate,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> FamilyOut:
    family = Family(name=body.name, timezone=body.timezone)
    session.add(family)
    await session.flush()

    membership = Membership(
        user_id=current_user.id,
        family_id=family.id,
        role=MembershipRole.owner,
    )
    session.add(membership)
    # The owner also gets a calendar persona so they can be assigned events (F13).
    await ensure_member_for_user(current_user, family.id, session)
    await session.commit()
    await session.refresh(family)
    return FamilyOut.model_validate(family)


@router.get("/{family_id}", response_model=FamilyOut)
async def get_family(family_and_membership: AnyFamilyMember) -> FamilyOut:
    family, _ = family_and_membership
    return FamilyOut.model_validate(family)


@router.patch("/{family_id}", response_model=FamilyOut)
async def update_family(
    body: FamilyUpdate,
    family_and_membership: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
) -> FamilyOut:
    family, _ = family_and_membership
    if body.name is not None:
        family.name = body.name
    if body.timezone is not None:
        family.timezone = body.timezone
    if body.weather_lat is not None:
        family.weather_lat = body.weather_lat
    if body.weather_lng is not None:
        family.weather_lng = body.weather_lng
    if body.weather_label is not None:
        family.weather_label = body.weather_label
    await session.commit()
    await session.refresh(family)
    await bus.publish(str(family.id), "family.updated", {"id": str(family.id), "name": family.name})
    return FamilyOut.model_validate(family)


@router.delete("/{family_id}", status_code=204)
async def delete_family(
    family_and_membership: FamilyOwnerOnly,
    session: AsyncSession = Depends(get_session),
) -> None:
    from datetime import datetime, timezone

    family, _ = family_and_membership
    family.deleted_at = datetime.now(timezone.utc)
    await session.commit()


@router.get("/{family_id}/memberships", response_model=list[MembershipOut])
async def list_memberships(
    family_and_membership: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
) -> list[MembershipOut]:
    family, _ = family_and_membership
    result = await session.execute(
        select(Membership).where(Membership.family_id == family.id)
    )
    return [MembershipOut.model_validate(m) for m in result.scalars()]


@router.patch("/{family_id}/lock", response_model=FamilyOut)
async def update_lock(
    body: LockUpdate,
    family_and_membership: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
) -> FamilyOut:
    family, _ = family_and_membership
    if body.enabled and not body.pin:
        raise HTTPException(status_code=422, detail="A PIN is required to enable the lock")
    family.lock_enabled = body.enabled
    if body.pin:
        family.lock_pin_hash = hash_pin(body.pin)
    elif not body.enabled:
        family.lock_pin_hash = None
    await session.commit()
    await session.refresh(family)
    return FamilyOut.model_validate(family)


@router.post("/{family_id}/lock/verify")
async def verify_lock(
    body: PinVerify,
    family_and_membership: AnyFamilyMember,
) -> dict:
    family, _ = family_and_membership
    if not family.lock_enabled or not family.lock_pin_hash:
        return {"verified": True}
    if not verify_pin(body.pin, family.lock_pin_hash):
        raise HTTPException(status_code=403, detail="Incorrect PIN")
    return {"verified": True}
