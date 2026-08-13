"""Server-Sent Events endpoint for realtime family updates."""

import asyncio
from collections.abc import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.deps import AnyFamilyMember
from app.services.realtime import bus

router = APIRouter(tags=["stream"])


@router.get("/families/{family_id}/stream")
async def event_stream(
    family_and_membership: AnyFamilyMember,
) -> StreamingResponse:
    family, _ = family_and_membership
    family_id = str(family.id)
    queue = bus.subscribe(family_id)

    async def generate() -> AsyncGenerator[str, None]:
        try:
            yield 'data: {"type":"connected"}\n\n'
            while True:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            bus.unsubscribe(family_id, queue)

    return StreamingResponse(generate(), media_type="text/event-stream")
