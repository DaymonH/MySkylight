"""Magic Import (F17) — Gemini-backed extraction of events and recipes.

The provider is mocked via ``app.dependency_overrides[get_provider]`` (no network). Tests cover
the route surface (503 unconfigured, role gating, mime/size guards before any model call,
empty/low-confidence handling), the pure date normalizer, the URL two-call fallback orchestration,
and a draft→create round-trip proving drafts mirror EventCreate/RecipeCreate.
"""

import base64
import uuid
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

import app.deps as deps_module
from app.ai import normalize
from app.ai.provider import GeminiProvider, ProviderError, get_provider
from app.main import app
from app.models.family import Family, Membership, MembershipRole
from app.models.user import User
from app.schemas.event import EventCreate
from app.schemas.magic_import import (
    EventDraft,
    EventExtractionResult,
    IngredientDraft,
    RawEvent,
    RawEventExtraction,
    RawIngredient,
    RawRecipe,
    RecipeDraft,
    RecipeExtractionResult,
)
from app.schemas.meal import RecipeCreate, RecipeIngredientIn
from app.services import calendar as cal_svc
from app.services import meals as meal_svc

PNG_B64 = base64.b64encode(b"\x89PNG\r\n\x1a\n-not-a-real-image-but-valid-b64").decode()


# ── helpers ───────────────────────────────────────────────────────────────────


async def _owned_family(client, auth_headers) -> str:
    """Create a family via the API; the test_user becomes its owner."""
    resp = await client.post("/api/v1/families", json={"name": "Importers"}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _auth_as(clerk_user_id: str) -> None:
    async def _verify(request: Request) -> str:  # request must be typed (see conftest note)
        return clerk_user_id

    app.dependency_overrides[deps_module.verify_clerk_token] = _verify


async def _make_user(session: AsyncSession, clerk_id: str, email: str) -> User:
    user = User(clerk_user_id=clerk_id, email=email)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


class FakeProvider:
    """Stands in for GeminiProvider — records calls, returns canned results or raises."""

    def __init__(self, *, events=None, recipe=None, error=False):
        self._events = events
        self._recipe = recipe
        self._error = error
        self.called = False
        self.last_tz: str | None = None

    async def extract_events(self, file_bytes, mime_type, family_tz):
        self.called = True
        self.last_tz = family_tz
        if self._error:
            raise ProviderError("boom")
        return self._events

    async def extract_recipe_from_image(self, file_bytes, mime_type):
        self.called = True
        if self._error:
            raise ProviderError("boom")
        return self._recipe

    async def extract_recipe_from_url(self, url):
        self.called = True
        if self._error:
            raise ProviderError("boom")
        return self._recipe


def _use_provider(fake: FakeProvider) -> None:
    app.dependency_overrides[get_provider] = lambda: fake


# ── 503 when unconfigured ───────────────────────────────────────────────────────


async def test_routes_503_when_unconfigured(client, auth_headers):
    """No GEMINI_API_KEY in the test env → get_provider 503s (no override installed)."""
    fid = await _owned_family(client, auth_headers)
    body = {"file_base64": PNG_B64, "mime_type": "image/png"}
    for path, payload in [
        (f"/api/v1/families/{fid}/magic-import/events", body),
        (f"/api/v1/families/{fid}/magic-import/recipes/image", body),
        (f"/api/v1/families/{fid}/magic-import/recipes/link", {"url": "https://example.com/r"}),
    ]:
        r = await client.post(path, json=payload, headers=auth_headers)
        assert r.status_code == 503, (path, r.status_code, r.text)


# ── role gating ─────────────────────────────────────────────────────────────────


async def test_extract_requires_owner_or_adult(client, auth_headers, session, test_user):
    fid = await _owned_family(client, auth_headers)
    _use_provider(FakeProvider(events=EventExtractionResult()))

    viewer = await _make_user(session, "user_viewer_mi", "viewer_mi@example.com")
    session.add(Membership(user_id=viewer.id, family_id=uuid.UUID(fid), role=MembershipRole.viewer))
    await session.commit()
    _auth_as(viewer.clerk_user_id)

    r = await client.post(
        f"/api/v1/families/{fid}/magic-import/events",
        json={"file_base64": PNG_B64, "mime_type": "image/png"},
        headers=auth_headers,
    )
    assert r.status_code == 403, r.text


# ── happy paths ─────────────────────────────────────────────────────────────────


async def test_extract_events_happy(client, auth_headers):
    fid = await _owned_family(client, auth_headers)
    result = EventExtractionResult(
        events=[
            EventDraft(
                title="Fun Run",
                start_dt=datetime(2026, 9, 14, 9, tzinfo=timezone.utc),
                end_dt=datetime(2026, 9, 14, 10, tzinfo=timezone.utc),
                all_day=False,
                year_inferred=True,
            ),
            EventDraft(
                title="Book Fair",
                start_dt=datetime(2027, 3, 3, tzinfo=timezone.utc),
                end_dt=datetime(2027, 3, 3, tzinfo=timezone.utc),
                all_day=True,
                time_inferred=True,
                year_inferred=True,
            ),
        ],
        confidence=0.8,
    )
    fake = FakeProvider(events=result)
    _use_provider(fake)

    r = await client.post(
        f"/api/v1/families/{fid}/magic-import/events",
        json={"file_base64": PNG_B64, "mime_type": "application/pdf"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["events"]) == 2
    assert body["events"][0]["all_day"] is False
    assert body["events"][1]["all_day"] is True and body["events"][1]["time_inferred"] is True
    assert body["confidence"] == 0.8
    # The route resolved and forwarded the family's timezone to the provider.
    assert fake.last_tz == "America/Denver"


async def test_extract_events_empty(client, auth_headers):
    fid = await _owned_family(client, auth_headers)
    empty = EventExtractionResult(events=[], confidence=0.1, notes="none")
    _use_provider(FakeProvider(events=empty))
    r = await client.post(
        f"/api/v1/families/{fid}/magic-import/events",
        json={"file_base64": PNG_B64, "mime_type": "image/png"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["events"] == []


async def test_extract_recipe_image_happy(client, auth_headers):
    fid = await _owned_family(client, auth_headers)
    draft = RecipeDraft(
        name="Chili",
        instructions="Simmer.",
        prep_minutes=15,
        cook_minutes=40,
        ingredients=[
            IngredientDraft(name="Beans", quantity=2, unit="can", section="Base", sort_order=0)
        ],
        confidence=0.9,
    )
    _use_provider(FakeProvider(recipe=RecipeExtractionResult(recipe=draft, confidence=0.9)))
    r = await client.post(
        f"/api/v1/families/{fid}/magic-import/recipes/image",
        json={"file_base64": PNG_B64, "mime_type": "image/jpeg"},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["recipe"]["name"] == "Chili"
    assert body["recipe"]["prep_minutes"] == 15 and body["recipe"]["cook_minutes"] == 40
    assert body["recipe"]["ingredients"][0] == {
        "name": "Beans",
        "quantity": 2.0,
        "unit": "can",
        "section": "Base",
        "sort_order": 0,
    }


async def test_extract_recipe_link_empty_page(client, auth_headers):
    fid = await _owned_family(client, auth_headers)
    none_found = RecipeExtractionResult(recipe=None, notes="Couldn't read that page.")
    _use_provider(FakeProvider(recipe=none_found))
    r = await client.post(
        f"/api/v1/families/{fid}/magic-import/recipes/link",
        json={"url": "https://example.com/paywalled"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["recipe"] is None


# ── guards run before the model is ever called ──────────────────────────────────


async def test_bad_input_skips_provider(client, auth_headers):
    fid = await _owned_family(client, auth_headers)
    fake = FakeProvider(events=EventExtractionResult())
    _use_provider(fake)
    base = f"/api/v1/families/{fid}/magic-import/events"

    # bad mime → 415
    r = await client.post(
        base, json={"file_base64": PNG_B64, "mime_type": "text/plain"}, headers=auth_headers
    )
    assert r.status_code == 415, r.text
    # invalid base64 → 400
    r = await client.post(
        base,
        json={"file_base64": "!!!notbase64!!!", "mime_type": "image/png"},
        headers=auth_headers,
    )
    assert r.status_code == 400, r.text
    # oversized → 413
    big = base64.b64encode(b"\x00" * (8 * 1024 * 1024 + 16)).decode()
    r = await client.post(
        base, json={"file_base64": big, "mime_type": "image/png"}, headers=auth_headers
    )
    assert r.status_code == 413, r.text

    assert fake.called is False  # none of the above reached the provider


async def test_provider_error_maps_to_502(client, auth_headers):
    fid = await _owned_family(client, auth_headers)
    _use_provider(FakeProvider(error=True))
    r = await client.post(
        f"/api/v1/families/{fid}/magic-import/events",
        json={"file_base64": PNG_B64, "mime_type": "image/png"},
        headers=auth_headers,
    )
    assert r.status_code == 502, r.text


# ── pure normalizer ─────────────────────────────────────────────────────────────


def test_normalize_year_inference_and_allday():
    now = datetime(2026, 6, 25, 9, tzinfo=timezone.utc)
    raw = RawEventExtraction(
        events=[
            RawEvent(title="Sept thing", date_text="Sept 14", start_time_text="9 AM",
                     has_explicit_year=False, has_explicit_time=True),   # future → 2026
            RawEvent(title="March thing", date_text="March 3",
                     has_explicit_year=False, has_explicit_time=False),  # past → 2027, all-day
            RawEvent(title="", date_text="Jan 1"),                       # dropped: no title
            RawEvent(title="No date"),                                   # dropped: no date
        ]
    )
    res = normalize.normalize_events(raw, "America/Denver", now=now)
    assert len(res.events) == 2
    sept, march = res.events
    assert sept.start_dt.year == 2026 and not sept.all_day and sept.year_inferred
    assert (sept.end_dt - sept.start_dt).seconds == 3600  # default 1h
    assert march.start_dt.year == 2027 and march.all_day and march.time_inferred
    assert march.start_dt == march.end_dt and march.start_dt.tzinfo is not None


def test_normalize_recipe_drops_empty_and_clamps():
    assert normalize.raw_recipe_to_draft(RawRecipe(found=False)) is None
    assert normalize.raw_recipe_to_draft(RawRecipe(found=True, name="  ")) is None
    d = normalize.raw_recipe_to_draft(
        RawRecipe(
            found=True,
            name=" Soup ",
            tags=[" warm ", ""],
            image_url="http://insecure/x.jpg",
            prep_minutes=-5,      # nonsensical → dropped
            cook_minutes=30,
            ingredients=[
                RawIngredient(name="Water", quantity=1, unit="L", section=" Broth "),
                RawIngredient(name=" "),
            ],
        ),
    )
    assert d.name == "Soup" and d.tags == ["warm"]
    assert d.image_url is None  # non-https dropped
    assert d.prep_minutes is None and d.cook_minutes == 30  # negative clamped to None
    assert len(d.ingredients) == 1 and d.ingredients[0].sort_order == 0
    assert d.ingredients[0].section == "Broth"  # trimmed


def test_normalize_instructions_splits_into_steps():
    # Existing line breaks are kept as-is.
    assert normalize.normalize_instructions("Boil water\nAdd pasta\nDrain") == (
        "Boil water\nAdd pasta\nDrain"
    )
    # Leading numbering / bullets the UI re-adds are stripped.
    assert normalize.normalize_instructions("1. Chop\n2. Cook") == "Chop\nCook"
    # A run-on line with inline numbering is split into steps.
    assert normalize.normalize_instructions("1. Chop onions. 2. Fry them. 3. Serve") == (
        "Chop onions.\nFry them.\nServe"
    )
    # An unnumbered paragraph falls back to sentence boundaries.
    assert normalize.normalize_instructions("Mix the flour. Add two eggs. Bake at 350.") == (
        "Mix the flour.\nAdd two eggs.\nBake at 350."
    )
    # Nothing usable → None.
    assert normalize.normalize_instructions("   ") is None
    assert normalize.normalize_instructions(None) is None
    # Round-trips through the draft mapper.
    d = normalize.raw_recipe_to_draft(
        RawRecipe(found=True, name="Soup", instructions="1. Boil. 2. Stir.")
    )
    assert d.instructions == "Boil.\nStir."


# ── provider URL two-call fallback orchestration (no network) ────────────────────


class _StubUrlProvider(GeminiProvider):
    """Exercises extract_recipe_from_url's orchestration without the genai client."""

    def __init__(self, page_text, raw_recipe):
        self._page_text = page_text
        self._raw_recipe = raw_recipe

    async def _fetch_url_text(self, url):
        return self._page_text

    async def _generate_structured(self, prompt, schema, parts):
        return self._raw_recipe


async def test_url_fallback_empty_page_returns_none():
    prov = _StubUrlProvider(page_text="", raw_recipe=RawRecipe(found=True, name="X"))
    res = await prov.extract_recipe_from_url("https://x")
    assert res.recipe is None and res.notes


async def test_url_fallback_text_then_structured():
    prov = _StubUrlProvider(
        page_text="# Soup\n- water\nboil it",
        raw_recipe=RawRecipe(found=True, name="Soup", ingredients=[RawIngredient(name="Water")]),
    )
    res = await prov.extract_recipe_from_url("https://example.com/soup")
    assert res.recipe is not None and res.recipe.name == "Soup"
    assert res.recipe.source_url == "https://example.com/soup"


# ── draft → existing create round-trip ──────────────────────────────────────────


async def test_event_draft_creates_via_existing_service(session: AsyncSession):
    family = Family(name="RT")
    session.add(family)
    await session.flush()
    draft = EventDraft(
        title="Fun Run",
        location="Park",
        start_dt=datetime(2026, 9, 14, 9, tzinfo=timezone.utc),
        end_dt=datetime(2026, 9, 14, 10, tzinfo=timezone.utc),
        all_day=False,
        is_countdown=True,
    )
    event = await cal_svc.create_event(
        family.id,
        EventCreate(
            title=draft.title,
            location=draft.location,
            start_dt=draft.start_dt,
            end_dt=draft.end_dt,
            all_day=draft.all_day,
            is_countdown=draft.is_countdown,
        ),
        session,
    )
    assert event.id and event.title == "Fun Run" and event.is_countdown is True


async def test_recipe_draft_creates_via_existing_service(session: AsyncSession):
    family = Family(name="RT2")
    session.add(family)
    await session.flush()
    draft = RecipeDraft(
        name="Chili",
        instructions="Simmer.",
        prep_minutes=15,
        cook_minutes=40,
        source_url="https://example.com/chili",
        ingredients=[
            IngredientDraft(name="Beans", quantity=2, unit="can", section="Base", sort_order=0)
        ],
    )
    recipe = await meal_svc.create_recipe(
        family.id,
        RecipeCreate(
            name=draft.name,
            instructions=draft.instructions,
            prep_minutes=draft.prep_minutes,
            cook_minutes=draft.cook_minutes,
            source_url=draft.source_url,
            ingredients=[
                RecipeIngredientIn(
                    name=i.name,
                    quantity=i.quantity,
                    unit=i.unit,
                    section=i.section,
                    sort_order=i.sort_order,
                )
                for i in draft.ingredients
            ],
        ),
        session,
    )
    assert recipe.id and recipe.name == "Chili"
    assert recipe.prep_minutes == 15 and recipe.cook_minutes == 40
    assert recipe.source_url == "https://example.com/chili"
    assert [i.name for i in recipe.ingredients] == ["Beans"]
    assert recipe.ingredients[0].section == "Base"
