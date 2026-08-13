from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings

_is_sqlite = "sqlite" in settings.database_url
_is_memory = ":memory:" in settings.database_url

_connect_args: dict = {}
_kwargs: dict = {}

if _is_sqlite:
    _connect_args = {"check_same_thread": False}
    if _is_memory:
        # In-memory SQLite for tests: share connection across threads via StaticPool
        _kwargs["poolclass"] = StaticPool

engine = create_async_engine(
    settings.database_url,
    connect_args=_connect_args,
    echo=settings.is_test,
    **_kwargs,
)

if _is_sqlite:

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, _connection_record) -> None:
        cursor = dbapi_conn.cursor()
        # SQLite ignores foreign keys unless explicitly enabled per-connection.
        cursor.execute("PRAGMA foreign_keys=ON")
        # WAL improves read/write concurrency for the household-scale workload.
        # It is unsupported (and pointless) for in-memory DBs.
        if not _is_memory:
            cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
