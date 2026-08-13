import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class WeatherCache(Base, TimestampMixin):
    __tablename__ = "weather_cache"
    __table_args__ = (UniqueConstraint("family_id", "location_key", "forecast_date"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id"), index=True)
    location_key: Mapped[str] = mapped_column(String(64))  # "lat,lng" rounded to 2 dp
    forecast_date: Mapped[date] = mapped_column(Date, index=True)
    data: Mapped[str] = mapped_column(Text)  # JSON blob from Open-Meteo
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    family: Mapped["Family"] = relationship()  # noqa: F821
