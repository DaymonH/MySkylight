from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings

_connect_args: dict = {}
_kwargs: dict = {}

if "sqlite" in settings.database_url:
    _connect_args = {"check_same_thread": False}
    if ":memory:" in settings.database_url:
        # In-memory SQLite for tests: share connection across threads via StaticPool
        _kwargs["poolclass"] = StaticPool

engine = create_async_engine(
    settings.database_url,
    connect_args=_connect_args,
    echo=settings.is_test,
    **_kwargs,
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
