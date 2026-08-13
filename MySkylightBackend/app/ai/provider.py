"""Gemini-backed Magic Import provider (F17).

A thin, swappable seam over the `google-genai` SDK. The vision model does OCR + structured
extraction in one call (no OCR pre-stage). `get_provider()` is the FastAPI dependency — it 503s
when unconfigured and is the override point for tests (no network).
"""

from __future__ import annotations

from fastapi import HTTPException

from app.core.config import settings
from app.ai import normalize
from app.schemas.magic_import import (
    EventExtractionResult,
    RawEventExtraction,
    RawRecipe,
    RecipeExtractionResult,
)

EVENT_PROMPT = (
    "You extract calendar events from an image or PDF of a flyer, invitation, school "
    "newsletter, or schedule. Return EVERY distinct event you can see. For each event, copy the "
    "date and time exactly as written into date_text / start_time_text / end_time_text, and set "
    "has_explicit_year and has_explicit_time to reflect whether the source actually states a year "
    "and a clock time. Do NOT invent a year, a time, or a timezone — leave them out and let the "
    "flags say so. Set is_countdown true only for a clearly milestone/countdown date. If there are "
    "no events, return an empty list. confidence is your 0-1 confidence in the extraction."
)

RECIPE_PROMPT = (
    "Extract a single cooking recipe from the provided content. Capture name, a short description, "
    "full instructions, servings, tags, and structured ingredients. Also capture prep_minutes and "
    "cook_minutes as whole numbers of minutes when the recipe states a prep and/or cook time (else "
    "null — do not guess). For each ingredient give a numeric quantity when one is stated (else "
    "null) plus its unit; keep any descriptive text (e.g. 'to taste', '1-2') in the ingredient "
    "name. When the ingredient list is grouped under headings (e.g. 'For the sauce', 'For the "
    "topping'), set each ingredient's section to its heading; leave section null when the list is "
    "ungrouped. Write the instructions as the ordered preparation steps, one step per line "
    "(separate steps with a newline) and without leading step numbers — the app numbers them. "
    "Set found=false if the content is not a recipe or no recipe could be read. "
    "confidence is your 0-1 confidence."
)

URL_TEXT_PROMPT = (
    "Read the recipe at this URL and return its full text as plain markdown — title, ingredient "
    "list, and step-by-step instructions. If the page has no recipe, say so briefly.\nURL: "
)

# Keep the model call under the FE proxy's ~20s ceiling so we return a clean error instead of
# the proxy aborting the request mid-flight.
PROVIDER_TIMEOUT_MS = 15_000


class ProviderError(RuntimeError):
    """Upstream model/transport failure — surfaced as a 502 by the router."""


class GeminiProvider:
    def __init__(self, api_key: str, model: str) -> None:
        # Imported lazily so importing this module never requires the SDK/key at import time.
        from google import genai
        from google.genai import types

        self._genai = genai
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=PROVIDER_TIMEOUT_MS),
        )
        self._model = model

    async def _generate_structured(self, prompt: str, schema: type, parts: list):
        from google.genai import types

        try:
            resp = await self._client.aio.models.generate_content(
                model=self._model,
                contents=[prompt, *parts],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=schema,
                ),
            )
        except Exception as exc:  # noqa: BLE001 — normalize SDK/transport errors
            raise ProviderError(str(exc)) from exc

        parsed = getattr(resp, "parsed", None)
        if isinstance(parsed, schema):
            return parsed
        text = getattr(resp, "text", None)
        if text:
            try:
                return schema.model_validate_json(text)
            except Exception as exc:  # noqa: BLE001
                raise ProviderError(f"could not parse model output: {exc}") from exc
        raise ProviderError("empty model response")

    def _part_from_bytes(self, data: bytes, mime_type: str):
        from google.genai import types

        return types.Part.from_bytes(data=data, mime_type=mime_type)

    async def extract_events(
        self, file_bytes: bytes, mime_type: str, family_tz: str
    ) -> EventExtractionResult:
        raw: RawEventExtraction = await self._generate_structured(
            EVENT_PROMPT, RawEventExtraction, [self._part_from_bytes(file_bytes, mime_type)]
        )
        return normalize.normalize_events(raw, family_tz)

    async def extract_recipe_from_image(
        self, file_bytes: bytes, mime_type: str
    ) -> RecipeExtractionResult:
        raw: RawRecipe = await self._generate_structured(
            RECIPE_PROMPT, RawRecipe, [self._part_from_bytes(file_bytes, mime_type)]
        )
        draft = normalize.raw_recipe_to_draft(raw)
        return RecipeExtractionResult(
            recipe=draft,
            confidence=raw.confidence,
            notes=None if draft else "No recipe found in that image.",
        )

    async def extract_recipe_from_url(self, url: str) -> RecipeExtractionResult:
        # Two calls: url-context fetch → text, then text → structured recipe. This is the
        # reliable path (tools + structured output don't always combine in one request).
        text = await self._fetch_url_text(url)
        if not text or not text.strip():
            return RecipeExtractionResult(recipe=None, notes="Couldn't read that page.")
        raw: RawRecipe = await self._generate_structured(RECIPE_PROMPT, RawRecipe, [text])
        draft = normalize.raw_recipe_to_draft(raw, source_url=url)
        return RecipeExtractionResult(
            recipe=draft,
            confidence=raw.confidence,
            notes=None if draft else "No recipe found on that page.",
        )

    async def _fetch_url_text(self, url: str) -> str | None:
        from google.genai import types

        try:
            resp = await self._client.aio.models.generate_content(
                model=self._model,
                contents=[URL_TEXT_PROMPT + url],
                config=types.GenerateContentConfig(
                    tools=[types.Tool(url_context=types.UrlContext())],
                ),
            )
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(str(exc)) from exc
        return getattr(resp, "text", None)


def get_provider() -> GeminiProvider:
    """FastAPI dependency. 503s when AI isn't configured; override in tests for a fake."""
    if not settings.gemini_configured:
        raise HTTPException(status_code=503, detail="AI features are not configured")
    return GeminiProvider(settings.gemini_api_key, settings.gemini_model)
