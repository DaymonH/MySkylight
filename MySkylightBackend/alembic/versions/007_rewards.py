"""Rewards / star economy (F14): rewards, redemptions + task star fields

Revision ID: 007
Revises: 006
Create Date: 2026-06-15
"""

from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Star fields on the tasks engine.
    op.add_column(
        "tasks", sa.Column("star_value", sa.Integer(), nullable=False, server_default="1")
    )
    op.add_column(
        "task_completions",
        sa.Column("stars_awarded", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "rewards",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("star_cost", sa.Integer(), nullable=False),
        sa.Column("icon", sa.String(16), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_rewards_family_id", "rewards", ["family_id"])

    op.create_table(
        "redemptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("reward_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("star_cost", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "approved", "rejected", name="redemption_status"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.ForeignKeyConstraint(["reward_id"], ["rewards.id"]),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_redemptions_family_id", "redemptions", ["family_id"])
    op.create_index("ix_redemptions_reward_id", "redemptions", ["reward_id"])
    op.create_index("ix_redemptions_member_id", "redemptions", ["member_id"])


def downgrade() -> None:
    op.drop_table("redemptions")
    op.drop_table("rewards")
    op.drop_column("task_completions", "stars_awarded")
    op.drop_column("tasks", "star_value")
