import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDeleteMixin, TimestampMixin


class ListType(str, enum.Enum):
    todo = "todo"
    grocery = "grocery"


class List(Base, TimestampMixin, SoftDeleteMixin):
    """A shared, family-wide list (to-do or grocery)."""

    __tablename__ = "lists"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    list_type: Mapped[ListType] = mapped_column(
        Enum(ListType, name="list_type"), default=ListType.todo
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    family: Mapped["Family"] = relationship()  # noqa: F821
    items: Mapped[list["ListItem"]] = relationship(
        back_populates="list", cascade="all, delete-orphan"
    )


class ListItem(Base, TimestampMixin, SoftDeleteMixin):
    """A single line on a list. Optionally categorized, quantified, and assigned to a member."""

    __tablename__ = "list_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    list_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lists.id"), index=True)
    text: Mapped[str] = mapped_column(String(500))
    # Free-text so groceries can say "2 lbs" / "a dozen"; F28 adds structured qty on recipes.
    quantity: Mapped[str | None] = mapped_column(String(50), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_checked: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assignee_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("members.id"), index=True, nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    list: Mapped["List"] = relationship(back_populates="items")
    assignee: Mapped["Member | None"] = relationship()  # noqa: F821
