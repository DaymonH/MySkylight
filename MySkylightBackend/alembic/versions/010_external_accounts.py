"""External calendar accounts + discovered calendars (F18 Google / F20 Apple)

Revision ID: 010
Revises: 009
Create Date: 2026-06-15
"""

from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "external_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column(
            "provider", sa.Enum("google", "apple", name="external_provider"), nullable=False
        ),
        sa.Column("account_email", sa.String(320), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expiry", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scopes", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("active", "needs_reauth", name="external_account_status"),
            nullable=False,
            server_default="active",
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("family_id", "provider", "account_email"),
    )
    op.create_index("ix_external_accounts_family_id", "external_accounts", ["family_id"])

    op.create_table(
        "external_calendars",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("external_id", sa.String(512), nullable=False),
        sa.Column("name", sa.String(512), nullable=False),
        sa.Column("color", sa.String(7), nullable=True),
        sa.Column("calendar_id", sa.Uuid(), nullable=True),
        sa.Column("sync_token", sa.Text(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["external_accounts.id"]),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.ForeignKeyConstraint(["calendar_id"], ["calendars.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "external_id"),
    )
    op.create_index("ix_external_calendars_account_id", "external_calendars", ["account_id"])
    op.create_index("ix_external_calendars_family_id", "external_calendars", ["family_id"])
    op.create_index("ix_external_calendars_calendar_id", "external_calendars", ["calendar_id"])


def downgrade() -> None:
    op.drop_table("external_calendars")
    op.drop_table("external_accounts")
