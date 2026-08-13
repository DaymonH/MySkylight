from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.core.config import settings
from app.core.database import engine
from app.core.logging import RequestIDMiddleware
from app.models.base import Base
import app.models.calendar  # noqa: F401 — registers tables for Base.metadata
import app.models.external  # noqa: F401
import app.models.list  # noqa: F401
import app.models.meal  # noqa: F401
import app.models.reward  # noqa: F401
import app.models.task  # noqa: F401
import app.models.weather  # noqa: F401
from app.routers import (
    events,
    external,
    families,
    health,
    invitations,
    lists,
    magic_import,
    me,
    meals,
    members,
    rewards,
    stream,
    tasks,
    weather,
    webhooks,
)
from app.services.scheduler import shutdown_scheduler, start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Create tables in test / dev (migrations handle prod)
    if settings.is_test:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    # Background jobs (weather refresh, …). Skipped under tests — no network / loops.
    if not settings.is_test:
        start_scheduler()
    try:
        yield
    finally:
        if not settings.is_test:
            shutdown_scheduler()


app = FastAPI(
    title="MySkylight API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(RequestIDMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Reject requests with an unexpected Host header (skipped when configured as "*").
if settings.allowed_hosts_list != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list)

app.include_router(health.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
app.include_router(webhooks.router, prefix="/api/v1")
app.include_router(families.router, prefix="/api/v1")
app.include_router(members.router, prefix="/api/v1")
app.include_router(invitations.router, prefix="/api/v1")
app.include_router(stream.router, prefix="/api/v1")
app.include_router(events.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(lists.router, prefix="/api/v1")
app.include_router(meals.router, prefix="/api/v1")
app.include_router(magic_import.router, prefix="/api/v1")
app.include_router(rewards.router, prefix="/api/v1")
app.include_router(weather.router, prefix="/api/v1")
app.include_router(external.router, prefix="/api/v1")
