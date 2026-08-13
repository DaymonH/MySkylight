"""Rotating chore assignment (F27): Task.assignment_strategy + TaskAssignment.sort_order

Revision ID: 006
Revises: 005
Create Date: 2026-06-15
"""

from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column(
            "assignment_strategy",
            sa.Enum("fixed", "rotating", name="assignment_strategy"),
            nullable=False,
            server_default="fixed",
        ),
    )
    op.add_column(
        "task_assignments",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("task_assignments", "sort_order")
    op.drop_column("tasks", "assignment_strategy")
