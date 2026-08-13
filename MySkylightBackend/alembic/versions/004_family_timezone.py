"""Family timezone: per-family IANA tz for DST-correct recurrence expansion

Revision ID: 004
Revises: 003
Create Date: 2026-06-14
"""

from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default backfills existing rows to US Mountain Time (DST-aware).
    op.add_column(
        "families",
        sa.Column(
            "timezone",
            sa.String(64),
            nullable=False,
            server_default=sa.text("'America/Denver'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("families", "timezone")
