import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.validation import occurrence_window
from app.deps import AnyFamilyMember, FamilyOwnerOrAdult
from app.models.external import is_external_mirror
from app.schemas.event import EventCreate, EventOut, EventUpdate, OccurrenceOut
from app.services import calendar as svc
from app.services.realtime import bus

router = APIRouter(tags=["events"])

# Events mirrored from a connected external calendar (F18/F20) are read-only: the
# pull engine owns them and a local change would be clobbered on the next sync.
_READ_ONLY_MIRROR_DETAIL = "This event is synced from an external calendar and is read-only"


@router.get("/families/{family_id}/events/occurrences", response_model=list[OccurrenceOut])
async def get_occurrences(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    window: tuple[date, date] = Depends(occurrence_window),
    session: AsyncSession = Depends(get_session),
):
    from_date, to_date = window
    from_dt = datetime.combine(from_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    to_dt = datetime.combine(to_date, datetime.max.time()).replace(tzinfo=timezone.utc)
    return await svc.get_occurrences(family_id, from_dt, to_dt, session)


@router.get("/families/{family_id}/events", response_model=list[EventOut])
async def list_events(
    family_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    events = await svc.list_events(family_id, session)
    return [EventOut.model_validate(e) for e in events]


@router.post("/families/{family_id}/events", response_model=EventOut, status_code=201)
async def create_event(
    family_id: uuid.UUID,
    data: EventCreate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    try:
        event = await svc.create_event(family_id, data, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "event.created", {"id": str(event.id)})
    return EventOut.model_validate(event)


@router.get("/families/{family_id}/events/{event_id}", response_model=EventOut)
async def get_event(
    family_id: uuid.UUID,
    event_id: uuid.UUID,
    _auth: AnyFamilyMember,
    session: AsyncSession = Depends(get_session),
):
    event = await svc.get_event(event_id, family_id, session)
    if not event:
        raise HTTPException(404, "Event not found")
    return EventOut.model_validate(event)


@router.patch("/families/{family_id}/events/{event_id}", response_model=EventOut)
async def update_event(
    family_id: uuid.UUID,
    event_id: uuid.UUID,
    data: EventUpdate,
    _auth: FamilyOwnerOrAdult,
    session: AsyncSession = Depends(get_session),
):
    event = await svc.get_event(event_id, family_id, session)
    if not event:
        raise HTTPException(404, "Event not found")
    if is_external_mirror(event.ical_uid):
        raise HTTPException(403, _READ_ONLY_MIRROR_DETAIL)
    try:
        event = await svc.update_event(event, data, session)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await bus.publish(str(family_id), "event.updated", {"id": str(event.id)})
    return EventOut.model_validate(event)


@router.delete("/families/{family_id}/events/{event_id}", status_code=204)
async def delete_event(
    family_id: uuid.UUID,
    event_id: uuid.UUID,
    _auth: FamilyOwnerOrAdult,
    occurrence_date: date | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    event = await svc.get_event(event_id, family_id, session)
    if not event:
        raise HTTPException(404, "Event not found")
    if is_external_mirror(event.ical_uid):
        raise HTTPException(403, _READ_ONLY_MIRROR_DETAIL)
    if occurrence_date and event.rrule:
        await svc.cancel_occurrence(event, occurrence_date, session)
    else:
        await svc.soft_delete_event(event, session)
    await bus.publish(str(family_id), "event.deleted", {"id": str(event_id)})
