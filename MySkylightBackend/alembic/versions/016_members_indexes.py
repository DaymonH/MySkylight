"""Index members.family_id and members.user_id

The ``members`` table was the one core family-scoped table missing a ``family_id``
index — yet it's filtered on nearly every hot read (occurrence expansion, chore
rotation, reward balances, member/assignee validation, ``list_members``). SQLite
does not auto-index foreign keys, so every such read was a full table scan.
``user_id`` is indexed too, to back ``ensure_member_for_user``'s lookup.

Revision ID: 016
Revises: 015
Create Date: 2026-06-25
"""

from alembic import op

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # CREATE INDEX needs no batch/table-rebuild on SQLite.
    op.create_index("ix_members_family_id", "members", ["family_id"])
    op.create_index("ix_members_user_id", "members", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_members_user_id", table_name="members")
    op.drop_index("ix_members_family_id", table_name="members")
