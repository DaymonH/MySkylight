import pytest
from httpx import AsyncClient


async def test_health(client: AsyncClient):
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["env"] == "test"


async def test_version(client: AsyncClient):
    response = await client.get("/api/v1/version")
    assert response.status_code == 200
    assert "version" in response.json()


async def test_health_no_auth_required(client: AsyncClient):
    """Health endpoint must work without a token."""
    response = await client.get("/api/v1/health", headers={})
    assert response.status_code == 200
