"""Background job scheduler (APScheduler).

Owns periodic jobs that keep cached data fresh without a user request: the
weather-cache refresh and the read-only external-calendar pull (F18/F20). Started
in `main.py` lifespan, skipped under tests. A failing job logs and is swallowed —
it must never take the scheduler down.
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.logging import logger
from app.models.external import ExternalAccount, ExternalAccountStatus
from app.services import external_sync
from app.services.weather import refresh_cached_weather

scheduler = AsyncIOScheduler()


async def _refresh_weather_job() -> None:
    async with AsyncSessionLocal() as session:
        try:
            count = await refresh_cached_weather(session)
            if count:
                logger.info("weather.refresh", refreshed=count)
        except Exception as exc:  # a failing job must never kill the scheduler
            logger.warning("weather.refresh_failed", error=str(exc))


async def _refresh_external_job() -> None:
    """Pull every active external account's mapped calendars into their mirrors.

    One session, accounts synced sequentially; a single account's failure is
    isolated so the rest still sync.
    """
    async with AsyncSessionLocal() as session:
        accounts = (
            await session.execute(
                select(ExternalAccount)
                .where(
                    ExternalAccount.deleted_at.is_(None),
                    ExternalAccount.status == ExternalAccountStatus.active,
                )
                .options(selectinload(ExternalAccount.calendars))
            )
        ).scalars().all()
        for account in accounts:
            try:
                counts = await external_sync.sync_account(account, session)
                if counts.total:
                    logger.info(
                        "external.sync",
                        account=str(account.id),
                        created=counts.created,
                        updated=counts.updated,
                        deleted=counts.deleted,
                    )
            except Exception as exc:
                logger.warning("external.sync_failed", account=str(account.id), error=str(exc))


def start_scheduler() -> None:
    """Register enabled jobs and start the scheduler (no-op if none are enabled)."""
    if settings.weather_refresh_enabled:
        scheduler.add_job(
            _refresh_weather_job,
            "interval",
            minutes=settings.weather_refresh_minutes,
            id="weather_refresh",
            replace_existing=True,
            coalesce=True,     # collapse missed runs into one
            max_instances=1,   # never overlap a still-running sweep
        )

    # Polls every active account (Google + Apple); a no-op when there are none.
    # Apple needs no server config, so this isn't gated on Google credentials.
    if settings.external_sync_enabled:
        scheduler.add_job(
            _refresh_external_job,
            "interval",
            minutes=settings.external_sync_minutes,
            id="external_sync",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )

    if scheduler.get_jobs():
        scheduler.start()


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
