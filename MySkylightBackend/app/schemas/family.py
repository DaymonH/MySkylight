import uuid
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.family import MembershipRole


def _validate_iana_tz(v: str) -> str:
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError) as e:
        raise ValueError(f"Unknown timezone: {v!r}") from e
    return v


class FamilyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    timezone: str = "America/Denver"

    @field_validator("timezone")
    @classmethod
    def _check_tz(cls, v: str) -> str:
        return _validate_iana_tz(v)


class FamilyUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    timezone: str | None = None
    weather_lat: float | None = Field(None, ge=-90, le=90)
    weather_lng: float | None = Field(None, ge=-180, le=180)
    weather_label: str | None = Field(None, max_length=120)

    @field_validator("timezone")
    @classmethod
    def _check_tz(cls, v: str | None) -> str | None:
        return _validate_iana_tz(v) if v is not None else v

    @model_validator(mode="after")
    def _coords_paired(self) -> "FamilyUpdate":
        # Latitude and longitude only make sense together; reject a half-set pair.
        if (self.weather_lat is None) != (self.weather_lng is None):
            raise ValueError("weather_lat and weather_lng must be provided together")
        return self


class FamilyOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    timezone: str
    lock_enabled: bool
    weather_lat: float | None = None
    weather_lng: float | None = None
    weather_label: str | None = None
    created_at: datetime


class MembershipOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    user_id: uuid.UUID
    family_id: uuid.UUID
    role: MembershipRole
    created_at: datetime


class LockUpdate(BaseModel):
    enabled: bool
    pin: str | None = Field(None, min_length=4, max_length=8, pattern=r"^\d+$")


class PinVerify(BaseModel):
    pin: str = Field(min_length=4, max_length=8, pattern=r"^\d+$")
