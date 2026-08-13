"""Magic Import (F17) — AI extraction endpoints.

Stateless: these only EXTRACT and return drafts (no DB writes). The client reviews/edits the
drafts and saves them through the existing ``POST /events`` / ``POST /recipes`` endpoints. The
provider is injected via ``get_provider`` (503 when unconfigured; overridden in tests).
"""

import base64
import binascii

from fastapi import APIRouter, Depends, HTTPException

from app.ai.provider import GeminiProvider, ProviderError, get_provider
from app.deps import FamilyOwnerOrAdult
from app.schemas.magic_import import (
    EVENT_MIME,
    IMAGE_MIME,
    MAX_UPLOAD_BYTES,
    EventExtractionResult,
    FileExtractRequest,
    RecipeExtractionResult,
    RecipeLinkRequest,
)

router = APIRouter(tags=["magic-import"])


def _decode_upload(req: FileExtractRequest, allowed: set[str]) -> bytes:
    """Validate mime + size and return raw bytes. Raises before any model call."""
    if req.mime_type not in allowed:
        raise HTTPException(415, f"Unsupported mime_type; allowed: {sorted(allowed)}")
    data = req.file_base64
    if data.startswith("data:"):  # tolerate a data: URL prefix
        data = data.split(",", 1)[-1]
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(400, "file_base64 is not valid base64") from exc
    if not raw:
        raise HTTPException(400, "file is empty")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file exceeds {MAX_UPLOAD_BYTES} bytes")
    return raw


@router.post(
    "/families/{family_id}/magic-import/events", response_model=EventExtractionResult
)
async def extract_events(
    data: FileExtractRequest,
    _auth: FamilyOwnerOrAdult,
    provider: GeminiProvider = Depends(get_provider),
):
    family, _ = _auth
    raw = _decode_upload(data, EVENT_MIME)
    try:
        return await provider.extract_events(raw, data.mime_type, family.timezone)
    except ProviderError as exc:
        raise HTTPException(502, f"AI extraction failed: {exc}") from exc


@router.post(
    "/families/{family_id}/magic-import/recipes/image", response_model=RecipeExtractionResult
)
async def extract_recipe_from_image(
    data: FileExtractRequest,
    _auth: FamilyOwnerOrAdult,
    provider: GeminiProvider = Depends(get_provider),
):
    raw = _decode_upload(data, IMAGE_MIME)
    try:
        return await provider.extract_recipe_from_image(raw, data.mime_type)
    except ProviderError as exc:
        raise HTTPException(502, f"AI extraction failed: {exc}") from exc


@router.post(
    "/families/{family_id}/magic-import/recipes/link", response_model=RecipeExtractionResult
)
async def extract_recipe_from_link(
    data: RecipeLinkRequest,
    _auth: FamilyOwnerOrAdult,
    provider: GeminiProvider = Depends(get_provider),
):
    if not data.url.startswith(("http://", "https://")):
        raise HTTPException(400, "url must start with http:// or https://")
    try:
        return await provider.extract_recipe_from_url(data.url)
    except ProviderError as exc:
        raise HTTPException(502, f"AI extraction failed: {exc}") from exc
