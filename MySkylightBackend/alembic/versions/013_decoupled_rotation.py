"""Decoupled rotation cadence (F27): Task.rotation_unit / rotation_interval / rotation_anchor_date

Lets a rotating chore's handoff cadence differ from its recurrence (e.g. a daily
chore with a single weekly owner). Defaults reproduce the prior per-occurrence
behaviour exactly, so existing rotating tasks are unchanged.

Revision ID: 013
Revises: 012
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "rotation_unit",
            sa.Enum("occurrence", "day", "week", "month", name="rotation_unit"),
            nullable=False,
            server_default="occurrence",
        ),
    )
    op.add_column(
        "tasks",
        sa.Column("rotation_interval", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "tasks",
        sa.Column("rotation_anchor_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tasks", "rotation_anchor_date")
    op.drop_column("tasks", "rotation_interval")
    op.drop_column("tasks", "rotation_unit")
