import json
import uuid
from datetime import date, datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.weather import WeatherCache

_OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
_CACHE_TTL_SECONDS = 3600  # refresh at most once per hour


def _location_key(lat: float, lng: float) -> str:
    return f"{round(lat, 2)},{round(lng, 2)}"


async def _fetch_open_meteo(lat: float, lng: float, target_date: date) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(_OPEN_METEO, params={
            "latitude": lat,
            "longitude": lng,
            "hourly": "temperature_2m,precipitation_probability,weathercode,windspeed_10m",
            "daily": "weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset",
            "temperature_unit": "fahrenheit",
            "windspeed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "auto",
            "start_date": target_date.isoformat(),
            "end_date": target_date.isoformat(),
        })
        resp.raise_for_status()
        return resp.json()


async def get_weather(
    family_id: uuid.UUID,
    lat: float,
    lng: float,
    target_date: date,
    session: AsyncSession,
) -> dict:
    key = _location_key(lat, lng)
    now = datetime.now(timezone.utc)

    result = await session.execute(
        select(WeatherCache).where(
            WeatherCache.family_id == family_id,
            WeatherCache.location_key == key,
            WeatherCache.forecast_date == target_date,
        )
    )
    cached = result.scalar_one_or_none()
    if cached and (now - cached.fetched_at.replace(tzinfo=timezone.utc)).total_seconds() < _CACHE_TTL_SECONDS:
        return json.loads(cached.data)

    data = await _fetch_open_meteo(lat, lng, target_date)
    data_str = json.dumps(data)
    if cached:
        cached.data = data_str
        cached.fetched_at = now
    else:
        session.add(WeatherCache(
            family_id=family_id,
            location_key=key,
            forecast_date=target_date,
            data=data_str,
            fetched_at=now,
        ))
    await session.commit()
    return data


async def refresh_cached_weather(session: AsyncSession) -> int:
    """Re-fetch every cached forecast for today or later. Returns rows refreshed.

    Called on a schedule (see ``services/scheduler.py``) so the wall-mounted
    device shows fresh forecasts without anyone opening the app. Stale rows for
    past dates are left untouched — they'll simply never be read again.
    """
    today = datetime.now(timezone.utc).date()
    result = await session.execute(
        select(WeatherCache).where(WeatherCache.forecast_date >= today)
    )
    rows = list(result.scalars())

    refreshed = 0
    for row in rows:
        try:
            lat_s, lng_s = row.location_key.split(",")
            data = await _fetch_open_meteo(float(lat_s), float(lng_s), row.forecast_date)
        except Exception:
            # One bad location/network blip shouldn't abort the whole sweep.
            continue
        row.data = json.dumps(data)
        row.fetched_at = datetime.now(timezone.utc)
        refreshed += 1

    if refreshed:
        await session.commit()
    return refreshed
