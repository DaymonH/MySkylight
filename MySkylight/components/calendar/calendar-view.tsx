"use client"

import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import { useCalendars, useCreateCalendar, useOccurrences, useCreateEvent, useUpdateEvent } from "@/hooks/use-calendars"
import { useRealtime } from "@/hooks/use-realtime"
import { useGeolocation, useWeatherDays } from "@/hooks/use-weather"
import { MonthView } from "./month-view"
import { WeekView } from "./week-view"
import { DayView } from "./day-view"
import { ScheduleView } from "./schedule-view"
import { CountdownStrip } from "./countdown-strip"
import { EventSheet } from "./event-sheet"
import { Button } from "@/components/ui/button"
import type { CalendarView, MemberBrief, OccurrenceOut } from "@/lib/types/calendar"

interface CalendarViewProps {
  familyId: string
  defaultView?: CalendarView
  storageKey?: string
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function weekStart(d: Date) {
  const s = new Date(d)
  s.setDate(s.getDate() - s.getDay())
  return s
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function rangeForView(view: CalendarView, anchor: Date): { from: string; to: string } {
  if (view === "month") {
    const y = anchor.getFullYear(), m = anchor.getMonth()
    return {
      from: `${y}-${String(m + 1).padStart(2, "0")}-01`,
      to: `${y}-${String(m + 1).padStart(2, "0")}-${new Date(y, m + 1, 0).getDate()}`,
    }
  }
  if (view === "week") {
    const ws = weekStart(anchor)
    const we = new Date(ws); we.setDate(we.getDate() + 6)
    return { from: toYMD(ws), to: toYMD(we) }
  }
  if (view === "day") {
    const ymd = toYMD(anchor)
    return { from: ymd, to: ymd }
  }
  // schedule: next 90 days
  const we = new Date(anchor); we.setDate(we.getDate() + 90)
  return { from: toYMD(anchor), to: toYMD(we) }
}

function navLabel(view: CalendarView, anchor: Date) {
  if (view === "month") return `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`
  if (view === "week") {
    const ws = weekStart(anchor)
    const we = new Date(ws); we.setDate(we.getDate() + 6)
    if (ws.getMonth() === we.getMonth())
      return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}–${we.getDate()}, ${ws.getFullYear()}`
    return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()} – ${MONTH_NAMES[we.getMonth()]} ${we.getDate()}`
  }
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
  }
  return "Upcoming"
}

function navigate(view: CalendarView, anchor: Date, dir: -1 | 1): Date {
  const d = new Date(anchor)
  if (view === "month") d.setMonth(d.getMonth() + dir)
  else if (view === "week") d.setDate(d.getDate() + dir * 7)
  else if (view === "day") d.setDate(d.getDate() + dir)
  return d
}

export function CalendarView({ familyId, defaultView = "month", storageKey }: CalendarViewProps) {
  const [view, setView] = useState<CalendarView>(() => {
    if (storageKey && typeof window !== "undefined") {
      const saved = localStorage.getItem(storageKey)
      if (saved) return saved as CalendarView
    }
    return defaultView
  })
  const [anchor, setAnchor] = useState(new Date())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [defaultDate, setDefaultDate] = useState<string | undefined>()
  const [editing, setEditing] = useState<OccurrenceOut | undefined>()

  const api = useApi()

  useRealtime(familyId)

  const coords = useGeolocation()

  const { data: calendars = [] } = useCalendars(familyId)
  const { data: members = [] } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberBrief[]>(`/families/${familyId}/members`),
    enabled: !!familyId,
  })

  const { from, to } = rangeForView(view, anchor)
  const { data: occurrences = [], isLoading } = useOccurrences(familyId, from, to)

  // Collect dates needing weather (day + week views only)
  const weatherDates = useMemo(() => {
    if (view === "day") return [toYMD(anchor)]
    if (view === "week") {
      const ws = weekStart(anchor)
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(ws); d.setDate(d.getDate() + i); return toYMD(d)
      })
    }
    return []
  }, [view, anchor])
  const weatherByDate = useWeatherDays(familyId, coords, weatherDates)

  const createCalendar = useCreateCalendar(familyId)
  const createEvent = useCreateEvent(familyId)
  const updateEvent = useUpdateEvent(familyId)

  // Auto-create default "Family" calendar on first load
  useEffect(() => {
    if (calendars.length === 0 && !createCalendar.isPending) {
      createCalendar.mutate({ name: "Family", color: "#6366f1" })
    }
  }, [calendars.length]) // eslint-disable-line react-hooks/exhaustive-deps

  function changeView(v: CalendarView) {
    setView(v)
    if (storageKey) localStorage.setItem(storageKey, v)
  }

  function openNew(date?: string) {
    setEditing(undefined)
    setDefaultDate(date)
    setSheetOpen(true)
  }

  function openEdit(occ: OccurrenceOut) {
    setEditing(occ)
    setDefaultDate(undefined)
    setSheetOpen(true)
  }

  async function handleSubmit(data: {
    title: string; calendar_id: string; start_dt: string; end_dt: string
    all_day: boolean; location?: string; description?: string; rrule?: string
    is_countdown: boolean; member_ids: string[]; reminder_minutes: number[]
  }) {
    const calendar_id = data.calendar_id || calendars[0]?.id
    if (!calendar_id) return

    const payload = {
      ...data,
      calendar_id,
      start_dt: new Date(data.start_dt).toISOString(),
      end_dt: new Date(data.end_dt).toISOString(),
      rrule: data.rrule || undefined,
      location: data.location || undefined,
      description: data.description || undefined,
    }

    if (editing) {
      await updateEvent.mutateAsync({ eventId: editing.event_id, data: { ...payload, edit_mode: "all" } })
    } else {
      await createEvent.mutateAsync(payload)
    }
    setSheetOpen(false)
  }

  const VIEW_TABS: { label: string; value: CalendarView }[] = [
    { label: "Month", value: "month" },
    { label: "Week", value: "week" },
    { label: "Day", value: "day" },
    { label: "Schedule", value: "schedule" },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>Today</Button>
        <button
          onClick={() => setAnchor(navigate(view, anchor, -1))}
          className="rounded p-1 hover:bg-accent"
          aria-label="Previous"
        >
          ‹
        </button>
        <button
          onClick={() => setAnchor(navigate(view, anchor, 1))}
          className="rounded p-1 hover:bg-accent"
          aria-label="Next"
        >
          ›
        </button>
        <span className="flex-1 text-center text-sm font-medium">{navLabel(view, anchor)}</span>
        <div className="flex rounded-lg border text-xs">
          {VIEW_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => changeView(t.value)}
              className={`px-2 py-1 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                view === t.value ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => openNew()}>+ Add</Button>
      </div>

      {/* Countdown strip — shown on all views */}
      <CountdownStrip occurrences={occurrences} onEventClick={openEdit} />

      {/* View content */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : view === "month" ? (
          <MonthView
            year={anchor.getFullYear()}
            month={anchor.getMonth()}
            occurrences={occurrences}
            onDayClick={(date) => openNew(date)}
            onEventClick={openEdit}
          />
        ) : view === "week" ? (
          <WeekView
            startDate={weekStart(anchor)}
            occurrences={occurrences}
            onEventClick={openEdit}
            weatherByDate={weatherByDate}
          />
        ) : view === "day" ? (
          <DayView
            date={anchor}
            occurrences={occurrences}
            onEventClick={openEdit}
            weather={weatherByDate[toYMD(anchor)]}
          />
        ) : (
          <ScheduleView
            occurrences={occurrences}
            onEventClick={openEdit}
          />
        )}
      </div>

      <EventSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={handleSubmit}
        isPending={createEvent.isPending || updateEvent.isPending}
        calendars={calendars}
        members={members}
        defaultDate={defaultDate}
        editing={editing}
      />
    </div>
  )
}
