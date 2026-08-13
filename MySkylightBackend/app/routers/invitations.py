import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.deps import CurrentUser, FamilyOwnerOrAdult
from app.models.family import Invitation, InvitationStatus, Member, Membership, MembershipRole
from app.schemas.invitation import InvitationAccept, InvitationCreate, InvitationOut
from app.services.members import ensure_member_for_user
from app.services.realtime import bus

router = APIRouter(tags=["invitations"])


@router.post("/families/{family_id}/invitations", response_model=InvitationOut, status_code=201)
async def create_invitation(
    body: InvitationCreate,
    family_and_membership: FamilyOwnerOrAdult,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> InvitationOut:
    family, membership = family_and_membership

    # Only an owner may grant the owner role; an adult inviting an owner would be
    # a privilege escalation (the new user becomes owner on accept).
    if body.role == MembershipRole.owner and membership.role != MembershipRole.owner:
        raise HTTPException(status_code=403, detail="Only an owner can invite an owner")

    existing = await session.execute(
        select(Invitation).where(
            Invitation.family_id == family.id,
            Invitation.email == body.email,
            Invitation.status == InvitationStatus.pending,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A pending invitation for this email already exists")

    # If the invite is meant to claim an existing profile, validate it: it must be a
    # live member of *this* family and not already tied to a login. On accept its
    # user_id gets set, so it keeps every chore assignment it already has.
    if body.member_id is not None:
        result = await session.execute(
            select(Member).where(
                Member.id == body.member_id,
                Member.family_id == family.id,
                Member.deleted_at.is_(None),
            )
        )
        member = result.scalar_one_or_none()
        if member is None:
            raise HTTPException(status_code=404, detail="Profile not found in this family")
        if member.user_id is not None:
            raise HTTPException(status_code=409, detail="That profile already has a login")

    invitation = Invitation(
        family_id=family.id,
        invited_by_id=current_user.id,
        email=body.email,
        role=body.role,
        member_id=body.member_id,
    )
    session.add(invitation)
    await session.commit()
    await session.refresh(invitation)
    return InvitationOut.model_validate(invitation)


@router.get("/families/{family_id}/invitations", response_model=list[InvitationOut])
async def list_invitations(
    family_and_membership: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
) -> list[InvitationOut]:
    family, _ = family_and_membership
    result = await session.execute(
        select(Invitation).where(
            Invitation.family_id == family.id,
            Invitation.status == InvitationStatus.pending,
        )
    )
    return [InvitationOut.model_validate(i) for i in result.scalars()]


@router.delete("/families/{family_id}/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    invitation_id: uuid.UUID,
    family_and_membership: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
) -> None:
    family, _ = family_and_membership
    result = await session.execute(
        select(Invitation).where(
            Invitation.id == invitation_id,
            Invitation.family_id == family.id,
            Invitation.status == InvitationStatus.pending,
        )
    )
    inv = result.scalar_one_or_none()
    if inv is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    inv.status = InvitationStatus.revoked
    await session.commit()


@router.post("/invitations/accept", response_model=dict)
async def accept_invitation(
    body: InvitationAccept,
    current_user: CurrentUser,
    session: AsyncSession = Depends(get_session),
) -> dict:
    result = await session.execute(
        select(Invitation).where(
            Invitation.token == body.token,
            Invitation.status == InvitationStatus.pending,
        )
    )
    inv = result.scalar_one_or_none()
    if inv is None:
        raise HTTPException(status_code=404, detail="Invitation not found or already used")
    # SQLite drops tzinfo, so `expires_at` reads back naive — treat it as UTC
    # (that's how it was written) before comparing against an aware "now".
    expires_at = inv.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Invitation has expired")

    # Add the Membership unless the user already belongs to this family.
    existing_membership = await session.execute(
        select(Membership).where(
            Membership.user_id == current_user.id,
            Membership.family_id == inv.family_id,
        )
    )
    already_member = existing_membership.scalar_one_or_none() is not None
    if not already_member:
        session.add(Membership(
            user_id=current_user.id,
            family_id=inv.family_id,
            role=inv.role,
        ))

    # Resolve the invitee's calendar persona. If this invite was created to link an
    # existing, login-less profile (e.g. a spouse already on the chore board), claim
    # that profile — set its user_id — so all its task assignments carry over instead
    # of spawning a duplicate. We only claim when the user has no persona here yet and
    # the target is still unclaimed; otherwise we fall back to the default behaviour.
    member = None
    claimed = False
    if inv.member_id is not None and not already_member:
        result = await session.execute(
            select(Member).where(
                Member.id == inv.member_id,
                Member.family_id == inv.family_id,
                Member.user_id.is_(None),
                Member.deleted_at.is_(None),
            )
        )
        target = result.scalar_one_or_none()
        if target is not None:
            target.user_id = current_user.id
            member = target
            claimed = True

    # No profile to claim → auto-create their persona so they appear on the shared
    # calendar immediately (FEATURES F13). Idempotent — a re-accept won't duplicate it.
    created = False
    if member is None:
        member, created = await ensure_member_for_user(
            current_user, inv.family_id, session, is_child=inv.role == MembershipRole.child
        )
    inv.status = InvitationStatus.accepted
    await session.commit()
    if created:
        await bus.publish(str(inv.family_id), "member.created", {"id": str(member.id)})
    elif claimed:
        # The persona already exists on devices; its linked state changed.
        await bus.publish(str(inv.family_id), "member.updated", {"id": str(member.id)})
    return {
        "family_id": str(inv.family_id),
        "role": inv.role.value,
        "member_id": str(member.id),
        "claimed": claimed,
        "already_member": already_member,
    }
