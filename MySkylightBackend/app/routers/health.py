from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(tags=["health"])


class HealthOut(BaseModel):
    status: str
    env: str
    version: str


@router.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    return HealthOut(status="ok", env=settings.app_env, version="0.1.0")


@router.get("/version")
async def version() -> dict:
    return {"version": "0.1.0"}
