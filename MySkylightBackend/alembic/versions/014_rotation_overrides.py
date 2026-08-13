"""Rotation overrides (F27 swap/skip): task_rotation_overrides

Per-occurrence manual reassignment of a rotating task — a member (swap) or NULL
(skip / "not my week"). Reverting deletes the row. Unique per (task, date).

Revision ID: 014
Revises: 013
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_rotation_overrides",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "occurrence_date"),
    )
    op.create_index(
        "ix_task_rotation_overrides_task_id", "task_rotation_overrides", ["task_id"]
    )
    op.create_index(
        "ix_task_rotation_overrides_occurrence_date",
        "task_rotation_overrides",
        ["occurrence_date"],
    )
    op.create_index(
        "ix_task_rotation_overrides_member_id", "task_rotation_overrides", ["member_id"]
    )


def downgrade() -> None:
    op.drop_table("task_rotation_overrides")
