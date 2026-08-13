"""Shared pytest fixtures for the MySkylight backend test suite."""

import uuid
from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest
import pytest_asyncio
from fastapi import Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal, engine
from app.main import app
from app.models.base import Base
from app.models.user import User


@pytest_asyncio.fixture(autouse=True)
async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as s:
        yield s


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def test_user(session: AsyncSession) -> User:
    """An already-provisioned User in the DB (simulates post-webhook state)."""
    user = User(
        clerk_user_id="user_test_clerk_123",
        email="test@example.com",
        first_name="Test",
        last_name="User",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.fixture
def auth_headers(test_user: User):
    """Returns Authorization headers that bypass JWT verification in tests.

    The `verify_clerk_token` dep is patched to return the test user's clerk_user_id.
    """
    return {"Authorization": "Bearer test-token"}


@pytest.fixture(autouse=True)
def patch_clerk_verify(test_user: User):
    """Bypass real JWKS verification in all tests."""
    with patch(
        "app.core.security._jwks_client",
    ):
        with patch(
            "app.core.security.verify_clerk_token",
            return_value=test_user.clerk_user_id,
        ):
            # Override the dependency on the app
            from app.core.security import verify_clerk_token
            from app.deps import ClerkUserID
            import app.deps as deps_module

            original = deps_module.verify_clerk_token

            # `request` must be typed as Request — otherwise FastAPI treats it as a
            # required query param and authenticated routes 422 before the override runs.
            async def _mock_verify(request: Request) -> str:
                return test_user.clerk_user_id

            app.dependency_overrides[original] = _mock_verify
            yield
            app.dependency_overrides.clear()
