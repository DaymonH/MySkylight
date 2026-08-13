import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.family import InvitationStatus, MembershipRole


class InvitationCreate(BaseModel):
    email: EmailStr
    role: MembershipRole = MembershipRole.adult
    # Optional: link this invite to an existing, login-less profile. On accept that
    # profile is claimed (keeping its chore assignments) instead of creating a new
    # one. Must be a member of this family that isn't already tied to a login.
    member_id: uuid.UUID | None = None


class InvitationOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    family_id: uuid.UUID
    # Set when this invite will claim an existing profile on accept (NULL otherwise).
    member_id: uuid.UUID | None
    email: str
    role: MembershipRole
    status: InvitationStatus
    # Exposed so the (owner/adult) inviter can build a shareable accept link
    # (`/invite/accept?token=…`). There is no email server in this self-hosted
    # setup, so the inviter hands the link to the invitee out-of-band. Only
    # owner/adult can create/list invitations (see FamilyOwnerOrAdult).
    token: str
    expires_at: datetime
    created_at: datetime


class InvitationAccept(BaseModel):
    token: str = Field(min_length=1)
