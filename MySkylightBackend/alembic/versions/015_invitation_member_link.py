"""Invitation → existing Member link (claim-a-profile on accept)

Adds a nullable ``member_id`` FK to ``invitations``. When set, accepting the
invite *claims* that pre-created, login-less persona (setting its ``user_id``)
instead of auto-creating a duplicate — so the persona keeps all its existing
chore (task) assignments. NULL keeps the original behaviour (fresh persona).

Revision ID: 015
Revises: 014
Create Date: 2026-06-25
"""

from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Plain nullable column — no DB-level FK. SQLite can't ALTER-ADD a foreign-key
    # constraint without rebuilding the whole table (batch mode), and the integrity
    # win would be negligible: members are *soft*-deleted (rows are never physically
    # removed) and both the create- and accept-invitation routes validate the member
    # (family scope + unclaimed) before using it. The ORM keeps the relationship via
    # the model's ForeignKey; this is metadata-only and needs no DB constraint.
    op.add_column("invitations", sa.Column("member_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column("invitations", "member_id")
