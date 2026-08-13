"""Lists & groceries: lists, list_items (FEATURES F04 / Phase 4)

Revision ID: 005
Revises: 004
Create Date: 2026-06-15
"""

from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lists",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "list_type",
            sa.Enum("todo", "grocery", name="list_type"),
            nullable=False,
            server_default="todo",
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["family_id"], ["families.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lists_family_id", "lists", ["family_id"])

    op.create_table(
        "list_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("list_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("quantity", sa.String(50), nullable=True),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("is_checked", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignee_member_id", sa.Uuid(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["list_id"], ["lists.id"]),
        sa.ForeignKeyConstraint(["assignee_member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_list_items_list_id", "list_items", ["list_id"])
    op.create_index("ix_list_items_assignee_member_id", "list_items", ["assignee_member_id"])


def downgrade() -> None:
    op.drop_table("list_items")
    op.drop_table("lists")
