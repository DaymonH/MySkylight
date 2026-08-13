"""Schemas for external calendar sync — Phase 7 (F25 ICS import/export, F21 Cozi)."""

import uuid

from pydantic import BaseModel, Field, model_validator


class IcsImportRequest(BaseModel):
    """Import a `.ics` feed into a calendar — supply inline text **or** a feed URL.

    A URL covers the read-only no-API providers (e.g. **Cozi**, F21): point this at
    a published `.ics` feed and the server fetches it.
    """

    ics: str | None = Field(None, description="Raw VCALENDAR text")
    url: str | None = Field(None, description="HTTP(S) URL of a .ics feed to fetch")

    @model_validator(mode="after")
    def _exactly_one_source(self) -> "IcsImportRequest":
        if bool(self.ics) == bool(self.url):
            raise ValueError("Provide exactly one of `ics` or `url`")
        return self


class IcsImportResult(BaseModel):
    calendar_id: uuid.UUID
    created: int
    updated: int
    total: int
