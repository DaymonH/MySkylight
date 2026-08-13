"""In-process pub/sub bus for server-sent events, scoped per family."""

import asyncio
import json
from asyncio import Queue


class RealtimeBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, list[Queue[str]]] = {}

    def subscribe(self, family_id: str) -> Queue[str]:
        q: Queue[str] = Queue(maxsize=100)
        self._subscribers.setdefault(family_id, []).append(q)
        return q

    def unsubscribe(self, family_id: str, q: Queue[str]) -> None:
        subs = self._subscribers.get(family_id, [])
        try:
            subs.remove(q)
        except ValueError:
            pass

    async def publish(self, family_id: str, event_type: str, data: dict) -> None:
        payload = json.dumps({"type": event_type, "data": data})
        for q in list(self._subscribers.get(family_id, [])):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass  # slow subscriber: drop rather than block


bus = RealtimeBus()
