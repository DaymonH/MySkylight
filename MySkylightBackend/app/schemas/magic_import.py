"""Schemas for Magic Import (F17) — AI extraction of calendar events and recipes.

Two layers:
  * ``Raw*`` models are handed to Gemini as ``response_schema`` (what the model fills in).
  * ``*Draft`` / ``*ExtractionResult`` models are what the API returns to the client —
    normalized + review-only metadata. Drafts mirror ``EventCreate`` / ``RecipeCreate`` so the
    frontend can save them through the existing create endpoints.
"""

from datetime import datetime

from pydantic import BaseModel, Field

# Max decoded upload size (after base64-decode). Family flyers/recipes are small and the
# frontend downscales images first; this keeps requests well under the proxy's 20s timeout.
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}
PDF_MIME = {"application/pdf"}
EVENT_MIME = IMAGE_MIME | PDF_MIME


# ── Requests ──────────────────────────────────────────────────────────────────


class FileExtractRequest(BaseModel):
    """A base64-encoded image/PDF upload. Mime + size are enforced in the router so we can
    return precise 415/413 codes (and never call the model on bad input)."""

    file_base64: str = Field(min_length=1)
    mime_type: str = Field(min_length=1)


class RecipeLinkRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


# ── Raw model output (Gemini response_schema) ───────────────────────────────────


class RawEvent(BaseModel):
    title: str = ""
    description: str | None = None
    location: str | None = None
    # Raw strings exactly as written on the flyer — the backend resolves them to real
    # datetimes using the family timezone. The model must NOT invent missing parts.
    date_text: str | None = None
    start_time_text: str | None = None
    end_time_text: str | None = None
    has_explicit_year: bool = False
    has_explicit_time: bool = False
    is_countdown: bool = False


class RawEventExtraction(BaseModel):
    events: list[RawEvent] = []
    confidence: float = 0.0
    notes: str | None = None


class RawIngredient(BaseModel):
    name: str = ""
    quantity: float | None = None
    unit: str | None = None
    # Grouping header this ingredient falls under ("For the sauce"), if the recipe groups them.
    section: str | None = None


class RawRecipe(BaseModel):
    found: bool = True
    name: str | None = None
    description: str | None = None
    instructions: str | None = None
    image_url: str | None = None
    servings: int | None = None
    # Prep / cook time in whole minutes, when the recipe states them.
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    tags: list[str] = []
    ingredients: list[RawIngredient] = []
    confidence: float = 0.0


# ── API output (drafts mirror EventCreate / RecipeCreate) ───────────────────────


class EventDraft(BaseModel):
    title: str
    description: str | None = None
    location: str | None = None
    start_dt: datetime
    end_dt: datetime
    all_day: bool = False
    is_countdown: bool = False
    # Review-only: the frontend badges these and strips them before POST /events.
    year_inferred: bool = False
    time_inferred: bool = False


class EventExtractionResult(BaseModel):
    events: list[EventDraft] = []
    confidence: float = 0.0
    notes: str | None = None


class IngredientDraft(BaseModel):
    name: str
    quantity: float | None = None
    unit: str | None = None
    section: str | None = None
    sort_order: int = 0


class RecipeDraft(BaseModel):
    name: str
    description: str | None = None
    instructions: str | None = None
    image_url: str | None = None
    servings: int | None = None
    prep_minutes: int | None = None
    cook_minutes: int | None = None
    tags: list[str] = []
    ingredients: list[IngredientDraft] = []
    confidence: float = 0.0
    source_url: str | None = None


class RecipeExtractionResult(BaseModel):
    recipe: RecipeDraft | None = None
    confidence: float = 0.0
    notes: str | None = None
