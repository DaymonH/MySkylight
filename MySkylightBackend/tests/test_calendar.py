"""Recurrence / occurrence-expansion tests for the calendar service."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar import Event
from app.models.external import ExternalAccount, ExternalCalendar, ExternalProvider
from app.models.family import Family, Member
from app.schemas.event import EventCreate, EventUpdate
from app.services import calendar as svc

UTC = timezone.utc


async def _setup(session: AsyncSession) -> Family:
    family = Family(name="Test Fam")
    session.add(family)
    await session.flush()
    return family


async def test_non_recurring_expansion_and_color(session: AsyncSession):
    family = await _setup(session)
    member = Member(family_id=family.id, name="Kid", color="#abcdef")
    session.add(member)
    await session.flush()

    start = datetime(2026, 1, 10, 9, 0, tzinfo=UTC)
    await svc.create_event(
        family.id,
        EventCreate(
            title="One-off",
            start_dt=start,
            end_dt=start + timedelta(hours=1),
            member_ids=[member.id],
        ),
        session,
    )
    occs = await svc.get_occurrences(
        family.id, datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 31, tzinfo=UTC), session
    )
    assert len(occs) == 1
    # No event-level override → falls back to the assigned member's colour
    assert occs[0].effective_color == "#abcdef"
    assert occs[0].is_recurring is False


async def test_unassigned_native_event_uses_default_color(session: AsyncSession):
    family = await _setup(session)
    start = datetime(2026, 1, 10, 9, 0, tzinfo=UTC)
    await svc.create_event(
        family.id,
        EventCreate(title="Solo", start_dt=start, end_dt=start + timedelta(hours=1)),
        session,
    )
    occs = await svc.get_occurrences(
        family.id, datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 31, tzinfo=UTC), session
    )
    assert occs[0].effective_color == svc.DEFAULT_EVENT_COLOR


async def test_occurrences_hide_unsynced_external_calendar(session: AsyncSession):
    """Mirrored events show only while their source calendar is synced; native always."""
    family = await _setup(session)
    acc = ExternalAccount(family_id=family.id, provider=ExternalProvider.apple)
    session.add(acc)
    await session.flush()
    on = ExternalCalendar(
        account_id=acc.id, family_id=family.id, external_id="ON",
        name="On", color="#0d9488", synced=True,
    )
    off = ExternalCalendar(
        account_id=acc.id, family_id=family.id, external_id="OFF",
        name="Off", color="#e11d6b", synced=False,
    )
    session.add_all([on, off])
    await session.flush()

    start = datetime(2026, 5, 1, 9, 0, tzinfo=UTC)
    session.add_all([
        Event(family_id=family.id, external_calendar_id=on.id, title="Visible",
              start_dt=start, end_dt=start + timedelta(hours=1), ical_uid="apple:ON:1"),
        Event(family_id=family.id, external_calendar_id=off.id, title="Hidden",
              start_dt=start, end_dt=start + timedelta(hours=1), ical_uid="apple:OFF:1"),
        Event(family_id=family.id, title="Native",
              start_dt=start, end_dt=start + timedelta(hours=1)),
    ])
    await session.commit()

    occs = await svc.get_occurrences(
        family.id, datetime(2026, 5, 1, tzinfo=UTC), datetime(2026, 5, 31, tzinfo=UTC), session
    )
    by_title = {o.title: o for o in occs}
    assert set(by_title) == {"Visible", "Native"}, set(by_title)
    # Synced event takes its source calendar's color; native falls back to the default.
    assert by_title["Visible"].effective_color == "#0d9488"
    assert by_title["Native"].effective_color == svc.DEFAULT_EVENT_COLOR
    assert by_title["Visible"].read_only is True


async def test_occurrence_source_labels_native_vs_external(session: AsyncSession):
    """Each occurrence carries provenance so duplicates can be told apart: native
    events read 'MySkylight'; mirrored ones name their calendar, provider, account."""
    family = await _setup(session)
    acc = ExternalAccount(
        family_id=family.id,
        provider=ExternalProvider.google,
        account_email="household@gmail.com",
    )
    session.add(acc)
    await session.flush()
    cal = ExternalCalendar(
        account_id=acc.id, family_id=family.id, external_id="primary",
        name="Holidays", color="#4285f4", synced=True,
    )
    session.add(cal)
    await session.flush()

    start = datetime(2026, 5, 1, 9, 0, tzinfo=UTC)
    session.add_all([
        Event(family_id=family.id, external_calendar_id=cal.id, title="Synced",
              start_dt=start, end_dt=start + timedelta(hours=1), ical_uid="google:primary:1"),
        Event(family_id=family.id, title="Native",
              start_dt=start, end_dt=start + timedelta(hours=1)),
    ])
    await session.commit()

    occs = await svc.get_occurrences(
        family.id, datetime(2026, 5, 1, tzinfo=UTC), datetime(2026, 5, 31, tzinfo=UTC), session
    )
    by_title = {o.title: o for o in occs}

    native = by_title["Native"].source
    assert native.kind == "local"
    assert native.label == svc.LOCAL_SOURCE_LABEL
    assert native.provider is None and native.account_email is None

    synced = by_title["Synced"].source
    assert synced.kind == "external"
    assert synced.label == "Holidays"
    assert synced.provider == "google"
    assert synced.account_email == "household@gmail.com"


async def test_following_edit_splits_series_cleanly(session: AsyncSession):
    family = await _setup(session)
    start = datetime(2026, 1, 1, 14, 0, tzinfo=UTC)
    ev = await svc.create_event(
        family.id,
        EventCreate(
            title="Daily",
            start_dt=start,
            end_dt=start + timedelta(hours=1),
            rrule="FREQ=DAILY;COUNT=10",
        ),
        session,
    )

    # "this and following" from the 6th occurrence
    await svc.update_event(
        ev,
        EventUpdate(edit_mode="following", occurrence_date=date(2026, 1, 6), title="Changed"),
        session,
    )

    occs = await svc.get_occurrences(
        family.id, datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 31, tzinfo=UTC), session
    )
    dates = sorted(o.occurrence_date for o in occs)
    # Exactly the 10 original days, each once — no duplicates, none lost
    assert dates == [date(2026, 1, d) for d in range(1, 11)], dates

    by_date = {o.occurrence_date: o for o in occs}
    assert by_date[date(2026, 1, 5)].title == "Daily"
    assert by_date[date(2026, 1, 6)].title == "Changed"
    assert by_date[date(2026, 1, 10)].title == "Changed"
    # Split occurrences keep the original 14:00 start time
    assert by_date[date(2026, 1, 6)].start_dt.hour == 14


async def test_single_occurrence_override_and_cancel(session: AsyncSession):
    family = await _setup(session)
    start = datetime(2026, 2, 1, 8, 0, tzinfo=UTC)
    ev = await svc.create_event(
        family.id,
        EventCreate(
            title="Standup",
            start_dt=start,
            end_dt=start + timedelta(minutes=30),
            rrule="FREQ=DAILY;COUNT=5",
        ),
        session,
    )

    # Override just Feb 3
    await svc.update_event(
        ev,
        EventUpdate(edit_mode="this", occurrence_date=date(2026, 2, 3), title="Special standup"),
        session,
    )
    # Cancel Feb 4
    await svc.cancel_occurrence(ev, date(2026, 2, 4), session)

    occs = await svc.get_occurrences(
        family.id, datetime(2026, 2, 1, tzinfo=UTC), datetime(2026, 2, 28, tzinfo=UTC), session
    )
    by_date = {o.occurrence_date: o for o in occs}
    assert date(2026, 2, 4) not in by_date  # cancelled
    assert by_date[date(2026, 2, 3)].title == "Special standup"
    assert by_date[date(2026, 2, 1)].title == "Standup"
    assert len(occs) == 4  # 5 minus the cancelled one


async def test_update_all_refreshes_assignments(session: AsyncSession):
    """The event returned from an update must reflect the new member set, not stale data."""
    family = await _setup(session)
    a = Member(family_id=family.id, name="A", color="#aaaaaa")
    b = Member(family_id=family.id, name="B", color="#bbbbbb")
    session.add_all([a, b])
    await session.flush()

    start = datetime(2026, 3, 1, 9, 0, tzinfo=UTC)
    await svc.create_event(
        family.id,
        EventCreate(
            title="Meeting",
            start_dt=start, end_dt=start + timedelta(hours=1),
            member_ids=[a.id], reminder_minutes=[15],
        ),
        session,
    )

    # Re-load through the same code path the router uses, then update — mimics one request.
    events = await svc.list_events(family.id, session)
    loaded = await svc.get_event(events[0].id, family.id, session)
    updated = await svc.update_event(
        loaded,
        EventUpdate(edit_mode="all", member_ids=[b.id], reminder_minutes=[30, 60]),
        session,
    )

    member_ids = {a_.member_id for a_ in updated.assignments}
    assert member_ids == {b.id}, member_ids
    assert sorted(r.minutes_before for r in updated.reminders) == [30, 60]


async def test_recurrence_preserves_local_time_across_dst(session: AsyncSession):
    """A weekly 9am series stays at 9am local across a DST boundary (no UTC drift)."""
    family = Family(name="NY Fam", timezone="America/New_York")
    session.add(family)
    await session.flush()

    # 9:00 America/New_York on Mon Mar 2 2026 (EST) == 14:00 UTC. US DST springs
    # forward on Sun Mar 8 2026, so Mar 9 onward is EDT.
    start = datetime(2026, 3, 2, 14, 0, tzinfo=UTC)
    await svc.create_event(
        family.id,
        EventCreate(
            title="Weekly 9am",
            start_dt=start,
            end_dt=start + timedelta(hours=1),
            rrule="FREQ=WEEKLY;COUNT=4",
        ),
        session,
    )
    occs = await svc.get_occurrences(
        family.id, datetime(2026, 3, 1, tzinfo=UTC), datetime(2026, 3, 31, tzinfo=UTC), session
    )

    ny = ZoneInfo("America/New_York")
    # Every occurrence is still 9am local…
    assert {o.start_dt.astimezone(ny).hour for o in occs} == {9}, [
        o.start_dt.isoformat() for o in occs
    ]
    by_date = {o.occurrence_date: o for o in occs}
    # …so the UTC hour shifts from 14:00 (EST) to 13:00 (EDT) across the boundary.
    assert by_date[date(2026, 3, 2)].start_dt.hour == 14
    assert by_date[date(2026, 3, 9)].start_dt.hour == 13


async def test_occurrence_date_uses_family_local_day(session: AsyncSession):
    """A late-evening event is dated by the family's local day, not its UTC day."""
    family = Family(name="LA Fam", timezone="America/Los_Angeles")
    session.add(family)
    await session.flush()

    # 23:00 America/Los_Angeles on Jan 5 2026 (PST, UTC-8) == 07:00 UTC Jan 6.
    start = datetime(2026, 1, 6, 7, 0, tzinfo=UTC)
    await svc.create_event(
        family.id,
        EventCreate(
            title="Late",
            start_dt=start,
            end_dt=start + timedelta(hours=1),
        ),
        session,
    )
    occs = await svc.get_occurrences(
        family.id, datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 31, tzinfo=UTC), session
    )
    assert len(occs) == 1
    # Belongs to Jan 5 in LA, not its UTC date (Jan 6).
    assert occs[0].occurrence_date == date(2026, 1, 5)


async def test_ics_feed_event_expands_with_ics_source(session: AsyncSession):
    """A subscribed-feed (ics) mirror event expands without error and is labelled
    with its provider. Regression: EventSource.provider must allow 'ics' — a
    missing literal raised a ValidationError that 500'd the *entire* /occurrences
    request, blanking the whole calendar (holidays, Apple mirrors, and native)."""
    family = await _setup(session)  # default tz America/Denver
    account = ExternalAccount(
        family_id=family.id,
        provider=ExternalProvider.ics,
        account_email="Subscribed feeds",
    )
    session.add(account)
    await session.flush()
    cal = ExternalCalendar(
        account_id=account.id, family_id=family.id,
        external_id="https://ex.test/holidays.ics", name="US Holidays", synced=True,
    )
    session.add(cal)
    await session.flush()
    session.add(
        Event(
            family_id=family.id,
            external_calendar_id=cal.id,
            title="Independence Day",
            start_dt=datetime(2026, 7, 4, 0, 0, tzinfo=UTC),
            end_dt=datetime(2026, 7, 5, 0, 0, tzinfo=UTC),
            all_day=True,
            ical_uid="ics:https://ex.test/holidays.ics:abc@google.com",
        )
    )
    await session.commit()

    occs = await svc.get_occurrences(
        family.id, datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 8, 1, tzinfo=UTC), session
    )
    assert len(occs) == 1
    assert occs[0].occurrence_date == date(2026, 7, 4)
    assert occs[0].source.provider == "ics"
    assert occs[0].read_only is True


async def test_all_day_event_not_shifted_by_timezone(session: AsyncSession):
    """An all-day event is a *floating date* — it stays on its stored day even in a
    negative-offset family. Regression: an all-day Jul 4 (stored as a midnight-UTC
    span, exactly how the ICS/holiday mirror stores it) must not slip to Jul 3 in
    America/Denver (UTC-6), where 00:00Z is the previous evening."""
    family = Family(name="CO Fam", timezone="America/Denver")
    session.add(family)
    await session.flush()

    session.add(
        Event(
            family_id=family.id,
            title="Independence Day",
            start_dt=datetime(2026, 7, 4, 0, 0, tzinfo=UTC),
            end_dt=datetime(2026, 7, 5, 0, 0, tzinfo=UTC),
            all_day=True,
        )
    )
    await session.commit()

    occs = await svc.get_occurrences(
        family.id, datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 7, 31, tzinfo=UTC), session
    )
    assert len(occs) == 1
    assert occs[0].occurrence_date == date(2026, 7, 4)  # not Jul 3


async def test_all_day_recurring_not_shifted_by_timezone(session: AsyncSession):
    """All-day *recurring* occurrences also keep their stored date in a
    negative-offset family — the series expands in UTC for all-day events, so each
    weekly occurrence stays on its calendar day instead of slipping back one."""
    family = Family(name="CO Fam Recurring", timezone="America/Denver")
    session.add(family)
    await session.flush()

    session.add(
        Event(
            family_id=family.id,
            title="Trash day",
            start_dt=datetime(2026, 7, 1, 0, 0, tzinfo=UTC),  # Wed
            end_dt=datetime(2026, 7, 2, 0, 0, tzinfo=UTC),
            all_day=True,
            rrule="FREQ=WEEKLY",
        )
    )
    await session.commit()

    occs = await svc.get_occurrences(
        family.id, datetime(2026, 7, 1, tzinfo=UTC), datetime(2026, 7, 31, tzinfo=UTC), session
    )
    assert sorted(o.occurrence_date for o in occs) == [
        date(2026, 7, 1),
        date(2026, 7, 8),
        date(2026, 7, 15),
        date(2026, 7, 22),
        date(2026, 7, 29),
    ]
