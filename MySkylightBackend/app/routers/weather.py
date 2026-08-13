from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.deps import AnyFamilyMember
from app.services.weather import get_weather

router = APIRouter(tags=["weather"])


@router.get("/families/{family_id}/weather")
async def fetch_weather(
    family_and_membership: AnyFamilyMember,
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    target_date: date = Query(..., alias="date"),
    session: AsyncSession = Depends(get_session),
):
    """Forecast for ``date``. Coordinates are optional — when omitted we use the
    family's saved weather location, so the wall display never needs geolocation."""
    family, _ = family_and_membership
    use_lat = lat if lat is not None else family.weather_lat
    use_lng = lng if lng is not None else family.weather_lng
    if use_lat is None or use_lng is None:
        raise HTTPException(400, "No weather location set for this family")
    try:
        return await get_weather(family.id, use_lat, use_lng, target_date, session)
    except Exception as e:
        raise HTTPException(502, f"Weather fetch failed: {e}")
