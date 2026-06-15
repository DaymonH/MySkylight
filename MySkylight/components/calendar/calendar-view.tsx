"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react"
import { useApi } from "@/hooks/use-api"
import {
  useCalendars,
  useCreateCalendar,
  useOccurrences,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
} from "@/hooks/use-calendars"
import { useRealtime } from "@/hooks/use-realtime"
import { useGeolocation, useWeatherDays } from "@/hooks/use-weather"
import { useVisibleHours } from "@/hooks/use-visible-hours"
import { MonthView } from "./month-view"
import { WeekView } from "./week-view"
import { DayView } from "./day-view"
import { ScheduleView } from "./schedule-view"
import { CountdownStrip } from "./countdown-strip"
import { EventSheet } from "./event-sheet"
import { CalendarSkeleton } from "./calendar-skeleton"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DEFAULT_CALENDAR_COLOR } from "@/lib/colors"
import { cn } from "@/lib/utils"
import type {
  CalendarView,
  MemberBrief,
  OccurrenceOut,
} from "@/lib/types/calendar"

interface CalendarViewProps {
  familyId: string
  defaultView?: CalendarView
  storageKey?: string
  /** "device" gets the larger, high-contrast wall-display treatment. */
  surface?: "device" | "app"
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
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function rangeForView(
  view: CalendarView,
  anchor: Date
): { from: string; to: string } {
  if (view === "month") {
    const y = anchor.getFullYear(),
      m = anchor.getMonth()
    return {
      from: `${y}-${String(m + 1).padStart(2, "0")}-01`,
      to: `${y}-${String(m + 1).padStart(2, "0")}-${new Date(y, m + 1, 0).getDate()}`,
    }
  }
  if (view === "week") {
    const ws = weekStart(anchor)
    const we = new Date(ws)
    we.setDate(we.getDate() + 6)
    return { from: toYMD(ws), to: toYMD(we) }
  }
  if (view === "day") {
    const ymd = toYMD(anchor)
    return { from: ymd, to: ymd }
  }
  // schedule: next 90 days
  const we = new Date(anchor)
  we.setDate(we.getDate() + 90)
  return { from: toYMD(anchor), to: toYMD(we) }
}

function navLabel(view: CalendarView, anchor: Date) {
  if (view === "month")
    return `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`
  if (view === "week") {
    const ws = weekStart(anchor)
    const we = new Date(ws)
    we.setDate(we.getDate() + 6)
    if (ws.getMonth() === we.getMonth())
      return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}–${we.getDate()}, ${ws.getFullYear()}`
    return `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()} – ${MONTH_NAMES[we.getMonth()]} ${we.getDate()}`
  }
  if (view === "day") {
    return anchor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
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

export function CalendarView({
  familyId,
  defaultView = "month",
  storageKey,
  surface = "app",
}: CalendarViewProps) {
  const isDevice = surface === "device"

  const [view, setView] = useState<CalendarView>(() => {
    if (storageKey && typeof window !== "undefined") {
      const saved = localStorage.getItem(storageKey)
      if (saved) return saved as CalendarView
    }
    return defaultView
  })
  const { start: dayStartHour, end: dayEndHour } = useVisibleHours()
  const [anchor, setAnchor] = useState(new Date())
  const [sheetOpen, setSheetOpen] = useState(false)
  const [defaultDate, setDefaultDate] = useState<string | undefined>()
  const [editing, setEditing] = useState<OccurrenceOut | undefined>()

  const api = useApi()

  useRealtime(familyId)

  const coords = useGeolocation()

  const calendarsQuery = useCalendars(familyId)
  const calendars = calendarsQuery.data ?? []
  const { data: members = [] } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberBrief[]>(`/families/${familyId}/members`),
    enabled: !!familyId,
  })

  const { from, to } = rangeForView(view, anchor)
  const { data: occurrences = [], isLoading } = useOccurrences(
    familyId,
    from,
    to
  )

  // Collect dates needing weather (day + week views only)
  const weatherDates = useMemo(() => {
    if (view === "day") return [toYMD(anchor)]
    if (view === "week") {
      const ws = weekStart(anchor)
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(ws)
        d.setDate(d.getDate() + i)
        return toYMD(d)
      })
    }
    return []
  }, [view, anchor])
  const weatherByDate = useWeatherDays(familyId, coords, weatherDates)

  const createCalendar = useCreateCalendar(familyId)
  const createEvent = useCreateEvent(familyId)
  const updateEvent = useUpdateEvent(familyId)
  const deleteEvent = useDeleteEvent(familyId)

  // Auto-create default "Family" calendar on first load — only after the query
  // has actually resolved (so initial undefined -> [] doesn't trigger a create),
  // and only once per mount to avoid racing duplicates.
  const autoCreatedRef = useRef(false)
  useEffect(() => {
    if (
      calendarsQuery.isSuccess &&
      calendars.length === 0 &&
      !autoCreatedRef.current &&
      !createCalendar.isPending
    ) {
      autoCreatedRef.current = true
      createCalendar.mutate({ name: "Family", color: DEFAULT_CALENDAR_COLOR })
    }
  }, [calendarsQuery.isSuccess, calendars.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
    title: string
    calendar_id: string
    start_dt: string
    end_dt: string
    all_day: boolean
    location?: string
    description?: string
    rrule?: string
    is_countdown: boolean
    member_ids: string[]
    reminder_minutes: number[]
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

    try {
      if (editing) {
        await updateEvent.mutateAsync({
          eventId: editing.event_id,
          data: { ...payload, edit_mode: "all" },
        })
        toast.success("Event updated")
      } else {
        await createEvent.mutateAsync(payload)
        toast.success("Event created")
      }
      setSheetOpen(false)
    } catch {
      toast.error("Couldn't save the event. Please try again.")
    }
  }

  async function handleDelete() {
    if (!editing) return
    try {
      await deleteEvent.mutateAsync({ eventId: editing.event_id })
      toast.success("Event deleted")
      setSheetOpen(false)
    } catch {
      toast.error("Couldn't delete the event. Please try again.")
    }
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
      <div
        className={cn(
          "flex flex-col gap-2.5 border-b px-3 py-2.5 lg:flex-row lg:items-center lg:gap-3",
          isDevice && "lg:px-5 lg:py-3.5"
        )}
      >
        {/* Date navigation */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size={isDevice ? "lg" : "sm"}
            onClick={() => setAnchor(new Date())}
          >
            Today
          </Button>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size={isDevice ? "icon" : "icon-sm"}
              onClick={() => setAnchor(navigate(view, anchor, -1))}
              aria-label="Previous"
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size={isDevice ? "icon" : "icon-sm"}
              onClick={() => setAnchor(navigate(view, anchor, 1))}
              aria-label="Next"
            >
              <ChevronRightIcon />
            </Button>
          </div>
          <h2
            className={cn(
              "min-w-0 flex-1 truncate font-heading font-semibold tracking-tight lg:flex-none",
              isDevice ? "text-2xl" : "text-base sm:text-lg"
            )}
          >
            {navLabel(view, anchor)}
          </h2>
        </div>

        {/* View switcher + add */}
        <div className="flex items-center gap-2 lg:ml-auto">
          <Tabs
            value={view}
            onValueChange={(v) => changeView(v as CalendarView)}
            className="min-w-0 flex-1 lg:flex-none"
          >
            <TabsList className={cn("w-full lg:w-fit", isDevice && "h-11")}>
              {VIEW_TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className={cn("flex-1", isDevice && "px-4 text-base")}
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button size={isDevice ? "lg" : "sm"} onClick={() => openNew()}>
            <PlusIcon />
            <span className={isDevice ? "" : "hidden sm:inline"}>Add</span>
          </Button>
        </div>
      </div>

      {/* Countdown strip — shown on all views */}
      <CountdownStrip
        occurrences={occurrences}
        onEventClick={openEdit}
        large={isDevice}
      />

      {/* View content */}
      <div className="thin-scrollbar flex-1 overflow-hidden">
        {isLoading ? (
          <CalendarSkeleton view={view} />
        ) : view === "month" ? (
          <div className="thin-scrollbar h-full overflow-auto">
            <MonthView
              year={anchor.getFullYear()}
              month={anchor.getMonth()}
              occurrences={occurrences}
              onDayClick={(date) => openNew(date)}
              onEventClick={openEdit}
              large={isDevice}
            />
          </div>
        ) : view === "week" ? (
          <WeekView
            startDate={weekStart(anchor)}
            occurrences={occurrences}
            onEventClick={openEdit}
            weatherByDate={weatherByDate}
            large={isDevice}
            dayStartHour={dayStartHour}
            dayEndHour={dayEndHour}
          />
        ) : view === "day" ? (
          <DayView
            date={anchor}
            occurrences={occurrences}
            onEventClick={openEdit}
            weather={weatherByDate[toYMD(anchor)]}
            large={isDevice}
            dayStartHour={dayStartHour}
            dayEndHour={dayEndHour}
          />
        ) : (
          <div className="thin-scrollbar h-full overflow-auto">
            <ScheduleView
              occurrences={occurrences}
              onEventClick={openEdit}
              onAdd={() => openNew()}
            />
          </div>
        )}
      </div>

      <EventSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={handleSubmit}
        onDelete={editing ? handleDelete : undefined}
        isPending={createEvent.isPending || updateEvent.isPending}
        isDeleting={deleteEvent.isPending}
        calendars={calendars}
        members={members}
        defaultDate={defaultDate}
        editing={editing}
      />
    </div>
  )
}
