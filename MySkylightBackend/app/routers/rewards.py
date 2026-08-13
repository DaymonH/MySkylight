import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.deps import AnyFamilyMember, FamilyOwnerOrAdult, require_family_role
from app.models.family import Family, Membership, MembershipRole
from app.models.reward import RedemptionStatus
from app.schemas.reward import (
    RedemptionCreate,
    RedemptionOut,
    RewardCreate,
    RewardOut,
    RewardUpdate,
    StarBalanceOut,
)
from app.services import rewards as svc
from app.services.realtime import bus

router = APIRouter(tags=["rewards"])

# Children may request a redemption; viewers are read-only.
FamilyActor = Annotated[
    tuple[Family, Membership],
    Depends(require_family_role(MembershipRole.owner, MembershipRole.adult, MembershipRole.child)),
]


# ── Rewards catalog ───────────────────────────────────────────────────────────


@router.get("/families/{family_id}/rewards", response_model=list[RewardOut])
async def list_rewards(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    return [RewardOut.model_validate(r) for r in await svc.list_rewards(family_id, session)]


@router.post("/families/{family_id}/rewards", response_model=RewardOut, status_code=201)
async def create_reward(
    family_id: uuid.UUID,
    data: RewardCreate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    reward = await svc.create_reward(family_id, data, session)
    await bus.publish(str(family_id), "reward.created", {"id": str(reward.id)})
    return RewardOut.model_validate(reward)


@router.patch("/families/{family_id}/rewards/{reward_id}", response_model=RewardOut)
async def update_reward(
    family_id: uuid.UUID,
    reward_id: uuid.UUID,
    data: RewardUpdate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    reward = await svc.get_reward(reward_id, family_id, session)
    if not reward:
        raise HTTPException(404, "Reward not found")
    reward = await svc.update_reward(reward, data, session)
    await bus.publish(str(family_id), "reward.updated", {"id": str(reward.id)})
    return RewardOut.model_validate(reward)


@router.delete("/families/{family_id}/rewards/{reward_id}", status_code=204)
async def delete_reward(
    family_id: uuid.UUID,
    reward_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    reward = await svc.get_reward(reward_id, family_id, session)
    if not reward:
        raise HTTPException(404, "Reward not found")
    await svc.soft_delete_reward(reward, session)
    await bus.publish(str(family_id), "reward.deleted", {"id": str(reward_id)})


@router.post(
    "/families/{family_id}/rewards/{reward_id}/redeem",
    response_model=RedemptionOut,
    status_code=201,
)
async def redeem_reward(
    family_id: uuid.UUID,
    reward_id: uuid.UUID,
    data: RedemptionCreate,
    _auth: FamilyActor,
    session: AsyncSession = Depends(get_session),
):
    reward = await svc.get_reward(reward_id, family_id, session)
    if not reward:
        raise HTTPException(404, "Reward not found")
    try:
        redemption = await svc.request_redemption(family_id, reward, data.member_id, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(
        str(family_id),
        "reward.redeemed",
        {"id": str(redemption.id), "member_id": str(data.member_id)},
    )
    return RedemptionOut.model_validate(redemption)


# ── Star balances ─────────────────────────────────────────────────────────────


@router.get("/families/{family_id}/star-balances", response_model=list[StarBalanceOut])
async def star_balances(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    return await svc.compute_balances(family_id, session)


# ── Redemptions (approval queue + history) ────────────────────────────────────


@router.get("/families/{family_id}/redemptions", response_model=list[RedemptionOut])
async def list_redemptions(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    status: RedemptionStatus | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    redemptions = await svc.list_redemptions(family_id, session, status)
    return [RedemptionOut.model_validate(r) for r in redemptions]


@router.post(
    "/families/{family_id}/redemptions/{redemption_id}/approve", response_model=RedemptionOut
)
async def approve_redemption(
    family_id: uuid.UUID,
    redemption_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    redemption = await svc.get_redemption(redemption_id, family_id, session)
    if not redemption:
        raise HTTPException(404, "Redemption not found")
    try:
        redemption = await svc.decide_redemption(redemption, True, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "reward.approved", {"id": str(redemption_id)})
    return RedemptionOut.model_validate(redemption)


@router.post(
    "/families/{family_id}/redemptions/{redemption_id}/reject", response_model=RedemptionOut
)
async def reject_redemption(
    family_id: uuid.UUID,
    redemption_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    redemption = await svc.get_redemption(redemption_id, family_id, session)
    if not redemption:
        raise HTTPException(404, "Redemption not found")
    try:
        redemption = await svc.decide_redemption(redemption, False, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "reward.rejected", {"id": str(redemption_id)})
    return RedemptionOut.model_validate(redemption)
