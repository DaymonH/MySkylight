"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react"
import { useApi } from "@/hooks/use-api"
import {
  useOccurrences,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
} from "@/hooks/use-calendars"
import { useRealtime } from "@/hooks/use-realtime"
import { useWeatherDays } from "@/hooks/use-weather"
import { useVisibleHours } from "@/hooks/use-visible-hours"
import { useActiveMember } from "@/hooks/use-active-member"
import { MemberFilter } from "./member-filter"
import { MonthView } from "./month-view"
import { WeekView } from "./week-view"
import { DayView } from "./day-view"
import { ScheduleView } from "./schedule-view"
import { CountdownStrip } from "./countdown-strip"
import { EventSheet } from "./event-sheet"
import { FlyerImportDialog } from "./flyer-import-dialog"
import { CalendarSkeleton } from "./calendar-skeleton"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  const [importOpen, setImportOpen] = useState(false)

  const api = useApi()

  useRealtime(familyId)

  // Weather uses the family's saved "home" location (set once in settings) rather
  // than browser geolocation, so no device prompts for location on every open.
  // Shares the ["family", familyId] cache, so saving a location live-updates here.
  const { data: family } = useQuery({
    queryKey: ["family", familyId],
    queryFn: () =>
      api.get<{ weather_lat: number | null; weather_lng: number | null }>(
        `/families/${familyId}`,
      ),
    enabled: !!familyId,
  })
  const coords =
    family?.weather_lat != null && family?.weather_lng != null
      ? { lat: family.weather_lat, lng: family.weather_lng }
      : null

  const { data: members = [] } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberBrief[]>(`/families/${familyId}/members`),
    enabled: !!familyId,
  })

  // Profile switcher: focus the calendar on a single member. Guard against a
  // stale selection (e.g. the member was deleted) by falling back to "Everyone".
  const { activeMemberId, setActiveMember } = useActiveMember(familyId, surface)
  const effectiveMemberId =
    activeMemberId && members.some((m) => m.id === activeMemberId) ? activeMemberId : null

  const { from, to } = rangeForView(view, anchor)
  const { data: occurrences = [], isLoading } = useOccurrences(
    familyId,
    from,
    to
  )

  // Occurrences shown after applying the profile filter. Strict: only events that
  // include the focused member (unassigned family-wide events show under "All").
  const visibleOccurrences = useMemo(
    () =>
      effectiveMemberId
        ? occurrences.filter((o) => o.members.some((m) => m.id === effectiveMemberId))
        : occurrences,
    [occurrences, effectiveMemberId]
  )

  // Countdowns are anchored to "today", not the viewed range. Querying only the
  // visible month meant a countdown tile vanished the moment you navigated away
  // from its event's month — so fetch a forward window (next year) independently
  // and feed that to the strip. Shares the ["occurrences", familyId, …] cache, so
  // realtime/mutation invalidations refresh it too.
  const countdownRange = useMemo(() => {
    const start = new Date()
    const end = new Date()
    end.setDate(end.getDate() + 365)
    return { from: toYMD(start), to: toYMD(end) }
  }, [])
  const { data: countdownOccurrences = [] } = useOccurrences(
    familyId,
    countdownRange.from,
    countdownRange.to
  )
  const visibleCountdowns = useMemo(
    () =>
      effectiveMemberId
        ? countdownOccurrences.filter((o) =>
            o.members.some((m) => m.id === effectiveMemberId)
          )
        : countdownOccurrences,
    [countdownOccurrences, effectiveMemberId]
  )

  // Mirrors CountdownStrip's own filter so we know whether the strip will render
  // anything — used to decide the shared filter/countdown band's borders.
  const hasCountdowns = useMemo(
    () =>
      visibleCountdowns.some(
        (o) => o.is_countdown && o.days_until !== null && o.days_until >= 0
      ),
    [visibleCountdowns]
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

  const createEvent = useCreateEvent(familyId)
  const updateEvent = useUpdateEvent(familyId)
  const deleteEvent = useDeleteEvent(familyId)

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
    const payload = {
      ...data,
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
          <div className="flex items-center overflow-hidden rounded-lg border">
            <Button
              variant="ghost"
              size={isDevice ? "icon" : "icon-sm"}
              className="rounded-none border-r"
              onClick={() => setAnchor(navigate(view, anchor, -1))}
              aria-label="Previous"
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size={isDevice ? "icon" : "icon-sm"}
              className="rounded-none"
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
          {!isDevice && (
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <SparklesIcon />
              <span className="hidden sm:inline">Import</span>
            </Button>
          )}
          <Button size={isDevice ? "lg" : "sm"} onClick={() => openNew()}>
            <PlusIcon />
            <span className={isDevice ? "" : "hidden sm:inline"}>Add</span>
          </Button>
        </div>
      </div>

      {/* Member filter + countdowns share one horizontal band so they don't eat
          two full rows of vertical space on the wide wall display; they stack
          only on narrow phone screens. */}
      {(members.length > 0 || hasCountdowns) && (
        <div className="flex flex-col border-b lg:flex-row lg:items-stretch">
          {/* Profile switcher — filter the calendar to one member (device + app) */}
          <MemberFilter
            members={members}
            activeMemberId={effectiveMemberId}
            onSelect={setActiveMember}
            large={isDevice}
            className={cn(
              "lg:flex-shrink-0",
              hasCountdowns && "border-b lg:border-r lg:border-b-0"
            )}
          />

          {/* Countdown strip — anchored to today, independent of the viewed month */}
          <CountdownStrip
            occurrences={visibleCountdowns}
            onEventClick={openEdit}
            large={isDevice}
            className="min-w-0 lg:flex-1"
          />
        </div>
      )}

      {/* View content */}
      <div className="thin-scrollbar flex-1 overflow-hidden">
        {isLoading ? (
          <CalendarSkeleton view={view} />
        ) : view === "month" ? (
          <div className="thin-scrollbar h-full overflow-auto">
            <MonthView
              year={anchor.getFullYear()}
              month={anchor.getMonth()}
              occurrences={visibleOccurrences}
              onDayClick={(date) => openNew(date)}
              onEventClick={openEdit}
              onViewDay={(date) => {
                changeView("day")
                setAnchor(new Date(`${date}T00:00:00`))
              }}
              large={isDevice}
            />
          </div>
        ) : view === "week" ? (
          <WeekView
            startDate={weekStart(anchor)}
            occurrences={visibleOccurrences}
            onEventClick={openEdit}
            weatherByDate={weatherByDate}
            large={isDevice}
            dayStartHour={dayStartHour}
            dayEndHour={dayEndHour}
          />
        ) : view === "day" ? (
          <DayView
            date={anchor}
            occurrences={visibleOccurrences}
            onEventClick={openEdit}
            weather={weatherByDate[toYMD(anchor)]}
            large={isDevice}
            dayStartHour={dayStartHour}
            dayEndHour={dayEndHour}
          />
        ) : (
          <div className="thin-scrollbar h-full overflow-auto">
            <ScheduleView
              occurrences={visibleOccurrences}
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
        members={members}
        defaultDate={defaultDate}
        editing={editing}
      />

      <FlyerImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        familyId={familyId}
      />
    </div>
  )
}
