import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.base import utcnow
from app.models.family import Member
from app.models.reward import Redemption, RedemptionStatus, Reward
from app.models.task import Task, TaskCompletion
from app.schemas.reward import RewardCreate, RewardUpdate, StarBalanceOut

# ── Reward CRUD ───────────────────────────────────────────────────────────────


async def list_rewards(
    family_id: uuid.UUID, session: AsyncSession, *, include_inactive: bool = True
) -> list[Reward]:
    q = select(Reward).where(Reward.family_id == family_id, Reward.deleted_at.is_(None))
    if not include_inactive:
        q = q.where(Reward.is_active.is_(True))
    result = await session.execute(
        q.order_by(Reward.sort_order, Reward.star_cost).execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def get_reward(
    reward_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession
) -> Reward | None:
    result = await session.execute(
        select(Reward)
        .where(Reward.id == reward_id, Reward.family_id == family_id, Reward.deleted_at.is_(None))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def create_reward(family_id: uuid.UUID, data: RewardCreate, session: AsyncSession) -> Reward:
    reward = Reward(family_id=family_id, **data.model_dump())
    session.add(reward)
    await session.commit()
    await session.refresh(reward)
    return reward


async def update_reward(reward: Reward, data: RewardUpdate, session: AsyncSession) -> Reward:
    fields = data.model_dump(exclude_unset=True)
    for k in ("name", "star_cost", "sort_order", "is_active"):
        if k in fields and fields[k] is not None:
            setattr(reward, k, fields[k])
    for k in ("description", "icon"):  # nullable — accept explicit None
        if k in fields:
            setattr(reward, k, fields[k])
    await session.commit()
    await session.refresh(reward)
    return reward


async def soft_delete_reward(reward: Reward, session: AsyncSession) -> None:
    reward.deleted_at = utcnow()
    await session.commit()


# ── Star balances (computed from completions + redemptions) ───────────────────


async def _earned_map(family_id: uuid.UUID, session: AsyncSession) -> dict[uuid.UUID, int]:
    result = await session.execute(
        select(
            TaskCompletion.member_id,
            func.coalesce(func.sum(TaskCompletion.stars_awarded), 0),
        )
        .join(Task, Task.id == TaskCompletion.task_id)
        .where(Task.family_id == family_id)
        .group_by(TaskCompletion.member_id)
    )
    return {mid: int(total) for mid, total in result.all()}


async def _redemption_maps(
    family_id: uuid.UUID, session: AsyncSession
) -> tuple[dict[uuid.UUID, int], dict[uuid.UUID, int]]:
    """Return (spent_by_member, pending_by_member)."""
    result = await session.execute(
        select(
            Redemption.member_id,
            Redemption.status,
            func.coalesce(func.sum(Redemption.star_cost), 0),
        )
        .where(Redemption.family_id == family_id)
        .group_by(Redemption.member_id, Redemption.status)
    )
    spent: dict[uuid.UUID, int] = {}
    pending: dict[uuid.UUID, int] = {}
    for mid, status, total in result.all():
        if status == RedemptionStatus.approved:
            spent[mid] = int(total)
        elif status == RedemptionStatus.pending:
            pending[mid] = int(total)
    return spent, pending


async def compute_balances(family_id: uuid.UUID, session: AsyncSession) -> list[StarBalanceOut]:
    earned = await _earned_map(family_id, session)
    spent, pending = await _redemption_maps(family_id, session)
    members = (
        await session.execute(
            select(Member)
            .where(Member.family_id == family_id, Member.deleted_at.is_(None))
            .order_by(Member.name)
        )
    ).scalars()
    out: list[StarBalanceOut] = []
    for m in members:
        e, s, p = earned.get(m.id, 0), spent.get(m.id, 0), pending.get(m.id, 0)
        out.append(
            StarBalanceOut(
                member_id=m.id, name=m.name, color=m.color,
                earned=e, spent=s, pending=p, available=e - s - p,
            )
        )
    return out


async def member_available(
    family_id: uuid.UUID, member_id: uuid.UUID, session: AsyncSession
) -> int:
    earned = (await _earned_map(family_id, session)).get(member_id, 0)
    spent, pending = await _redemption_maps(family_id, session)
    return earned - spent.get(member_id, 0) - pending.get(member_id, 0)


# ── Redemptions ───────────────────────────────────────────────────────────────

_REDEMPTION_LOADS = [selectinload(Redemption.member), selectinload(Redemption.reward)]


async def list_redemptions(
    family_id: uuid.UUID, session: AsyncSession, status: RedemptionStatus | None = None
) -> list[Redemption]:
    q = select(Redemption).where(Redemption.family_id == family_id).options(*_REDEMPTION_LOADS)
    if status is not None:
        q = q.where(Redemption.status == status)
    result = await session.execute(
        q.order_by(Redemption.created_at.desc()).execution_options(populate_existing=True)
    )
    return list(result.scalars())


async def get_redemption(
    redemption_id: uuid.UUID, family_id: uuid.UUID, session: AsyncSession
) -> Redemption | None:
    result = await session.execute(
        select(Redemption)
        .where(Redemption.id == redemption_id, Redemption.family_id == family_id)
        .options(*_REDEMPTION_LOADS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def request_redemption(
    family_id: uuid.UUID, reward: Reward, member_id: uuid.UUID, session: AsyncSession
) -> Redemption:
    member = (
        await session.execute(
            select(Member.id).where(
                Member.id == member_id,
                Member.family_id == family_id,
                Member.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise ValueError("Member not found in this family")
    if not reward.is_active:
        raise ValueError("Reward is not available")
    if await member_available(family_id, member_id, session) < reward.star_cost:
        raise ValueError("Not enough stars")

    redemption = Redemption(
        family_id=family_id,
        reward_id=reward.id,
        member_id=member_id,
        star_cost=reward.star_cost,
        status=RedemptionStatus.pending,
    )
    session.add(redemption)
    await session.commit()
    return await get_redemption(redemption.id, family_id, session)


async def decide_redemption(
    redemption: Redemption, approve: bool, session: AsyncSession
) -> Redemption:
    if redemption.status != RedemptionStatus.pending:
        raise ValueError("Redemption already decided")
    redemption.status = RedemptionStatus.approved if approve else RedemptionStatus.rejected
    redemption.decided_at = utcnow()
    await session.commit()
    return await get_redemption(redemption.id, redemption.family_id, session)
