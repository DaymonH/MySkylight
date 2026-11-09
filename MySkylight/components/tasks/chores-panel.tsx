"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  BanIcon,
  CalendarArrowDownIcon,
  CalendarClockIcon,
  CheckIcon,
  EllipsisVerticalIcon,
  PartyPopperIcon,
  StarIcon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { ChoresViewSwitch } from "@/components/chores-view-switch"
import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import { useTodayYMD } from "@/hooks/use-today"
import {
  useClearOccurrenceMove,
  useClearRotationOverride,
  useCompleteTask,
  useMoveOccurrence,
  useMoveTaskToToday,
  useRoutines,
  useSetRotationOverride,
  useTaskOccurrences,
  useTasks,
  useUncompleteTask,
} from "@/hooks/use-tasks"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { ChoreFilterBar } from "@/components/tasks/chore-filter-bar"
import { ClearMissedButton } from "@/components/tasks/clear-missed-button"
import { StarPop } from "@/components/tasks/star-pop"
import { cn } from "@/lib/utils"
import { ApiError, isDefiniteClientError } from "@/lib/api-client"
import {
  type ChoreFilters,
  DEFAULT_FILTERS,
  addDaysYMD,
  applyFilters,
  dayLabel,
  filtersActive,
  MISSED_LOOKBACK_DAYS,
  isOverdue,
  matchesStatus,
  weekDatesYMD,
  weekRangeYMD,
  withinMissedWindow,
} from "@/lib/chores"
import { canRephase, classifyFrequency, type ChoreFrequency } from "@/lib/recurrence"
import type { TaskOccurrenceOut } from "@/lib/types/task"

interface MemberRow {
  id: string
  name: string
  color: string
}

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}


/** 1 once everyone assigned has done it (or it's skipped), else 0 — for sinking done rows. */
function doneRank(o: TaskOccurrenceOut): number {
  if (o.is_skipped) return 1
  return o.members.length > 0 && o.members.every((m) => o.completed_member_ids.includes(m.id))
    ? 1
    : 0
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

/**
 * The companion-app chore view: the same Today/Week + overdue + filter experience
 * as the wall display, laid out as a phone-friendly list grouped by day. Tap an
 * assignee's avatar to mark their chore done (optimistic; syncs over SSE).
 */
export function ChoresPanel({ familyId }: { familyId: string }) {
  useRealtime(familyId)

  const api = useApi()
  // Rolls over at midnight on its own — the wall display never reloads.
  const today = useTodayYMD()

  const [view, setView] = useState<"today" | "week">("today")
  // The Edit screen's "Week" tab links here with #week.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the URL hash once after mount (static page; avoids a hydration mismatch)
    if (window.location.hash === "#week") setView("week")
  }, [])
  const [filters, setFilters] = useState<ChoreFilters>(DEFAULT_FILTERS)

  const week = weekRangeYMD(today)
  const mainFrom = view === "today" ? today : week.start
  const mainTo = view === "today" ? today : week.end
  const overdueAnchor = view === "today" ? today : week.start
  const overdueFrom = addDaysYMD(overdueAnchor, -MISSED_LOOKBACK_DAYS)
  const overdueTo = addDaysYMD(overdueAnchor, -1)

  const { data: members = [] } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberRow[]>(`/families/${familyId}/members`),
    enabled: !!familyId,
  })
  const { data: routines = [] } = useRoutines(familyId)
  const { data: tasks = [] } = useTasks(familyId)
  const { data: mainOccs = [], isLoading } = useTaskOccurrences(familyId, mainFrom, mainTo)
  const { data: pastOccs = [] } = useTaskOccurrences(familyId, overdueFrom, overdueTo)

  const complete = useCompleteTask(familyId)
  const uncomplete = useUncompleteTask(familyId)
  const setOverride = useSetRotationOverride(familyId)
  const clearOverride = useClearRotationOverride(familyId)
  const moveTask = useMoveTaskToToday(familyId)
  const moveOccurrence = useMoveOccurrence(familyId)
  const clearMove = useClearOccurrenceMove(familyId)

  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const role = memberships.find((m) => m.family_id === familyId)?.role
  const canManage = role === "owner" || role === "adult"

  const freqByTaskId = useMemo(
    () => new Map<string, ChoreFrequency>(tasks.map((t) => [t.id, classifyFrequency(t.rrule)])),
    [tasks],
  )
  // task_id → can "Move to today" re-phase it? (interval-style recurring, not BYDAY).
  const movableByTaskId = useMemo(
    () => new Map<string, boolean>(tasks.map((t) => [t.id, canRephase(t.rrule)])),
    [tasks],
  )
  const routineName = useMemo(() => {
    const m = new Map<string, string>()
    routines.forEach((r) => m.set(r.id, r.name))
    return m
  }, [routines])

  const filteredMain = useMemo(
    () => applyFilters(mainOccs, filters, freqByTaskId).filter((o) => matchesStatus(o, filters.status)),
    [mainOccs, filters, freqByTaskId],
  )

  // One section per day (today view = a single day), each with its occurrences.
  const dayGroups = useMemo(() => {
    const days = view === "today" ? [today] : weekDatesYMD(today)
    return days
      .map((date) => ({
        date,
        items: filteredMain
          .filter((o) => o.occurrence_date === date)
          // Open chores first; finished ones sink to the bottom of the day.
          .sort((a, b) => doneRank(a) - doneRank(b) || a.title.localeCompare(b.title)),
      }))
      .filter((g) => g.items.length > 0)
  }, [view, filteredMain, today])

  const overdueItems = useMemo(
    () =>
      applyFilters(pastOccs, filters, freqByTaskId)
        .filter(
          (o) =>
            isOverdue(o, overdueAnchor) &&
            withinMissedWindow(o, overdueAnchor, freqByTaskId.get(o.task_id) ?? "one-off") &&
            matchesStatus(o, filters.status),
        )
        .sort((a, b) =>
          a.occurrence_date === b.occurrence_date
            ? a.title.localeCompare(b.title)
            : a.occurrence_date.localeCompare(b.occurrence_date),
        ),
    [pastOccs, filters, freqByTaskId, overdueAnchor],
  )

  function toggle(o: TaskOccurrenceOut, memberId: string) {
    const done = o.completed_member_ids.includes(memberId)
    const vars = { taskId: o.task_id, memberId, occurrenceDate: o.occurrence_date }
    if (done) uncomplete.mutate(vars)
    else complete.mutate(vars)
  }
  // Only alert on a *definitive* rejection (4xx); transport hiccups are retried in
  // the hook and reconciled via SSE/refetch, so they shouldn't raise a false alarm.
  function swapTo(o: TaskOccurrenceOut, memberId: string) {
    setOverride.mutate(
      { taskId: o.task_id, occurrenceDate: o.occurrence_date, memberId, scope: "occurrence" },
      {
        onError: (err) => {
          if (isDefiniteClientError(err)) toast.error("Couldn't reassign this chore.")
        },
      },
    )
  }
  function skip(o: TaskOccurrenceOut, scope: "occurrence" | "turn") {
    setOverride.mutate(
      { taskId: o.task_id, occurrenceDate: o.occurrence_date, memberId: null, scope },
      {
        onError: (err) => {
          if (isDefiniteClientError(err)) toast.error("Couldn't skip this chore.")
        },
      },
    )
  }
  function resetRotation(o: TaskOccurrenceOut) {
    clearOverride.mutate(
      { taskId: o.task_id, occurrenceDate: o.occurrence_date, scope: "occurrence" },
      {
        onError: (err) => {
          if (isDefiniteClientError(err)) toast.error("Couldn't reset this chore.")
        },
      },
    )
  }
  // Re-anchor the chore's recurrence to today so its cadence re-phases from today.
  // This row groups all assignees under one menu (no single "current member"), so we
  // only re-phase here and let the user tap an avatar to complete — unlike the wall
  // display's per-member Missed rows, which also auto-complete today.
  function moveToToday(o: TaskOccurrenceOut) {
    moveTask.mutate(
      { taskId: o.task_id },
      {
        onError: (err) => {
          if (isDefiniteClientError(err)) toast.error("Couldn't move this chore.")
        },
      },
    )
  }

  // "Do it tomorrow": push just this occurrence to a later day, leaving the series'
  // cadence alone. A missed one lands on today instead. Hidden for daily chores —
  // tomorrow already has its own occurrence, so there's nowhere to put it.
  function deferOccurrence(o: TaskOccurrenceOut) {
    const toDate = o.occurrence_date < today ? today : addDaysYMD(o.occurrence_date, 1)
    moveOccurrence.mutate(
      { taskId: o.task_id, occurrenceDate: o.occurrence_date, toDate },
      {
        onSuccess: () =>
          toast.success(`${o.title} moved to ${dayLabel(toDate, today)}`, {
            action: {
              label: "Undo",
              onClick: () =>
                clearMove.mutate(
                  { taskId: o.task_id, occurrenceDate: o.occurrence_date },
                  { onError: () => toast.error("Couldn't undo. Please try again.") },
                ),
            },
          }),
        onError: (err) =>
          toast.error(err instanceof ApiError && err.message ? err.message : "Couldn't move this chore."),
      },
    )
  }

  // When a member filter is active, only show the avatars that pass it.
  function visibleMembersOf(o: TaskOccurrenceOut) {
    if (filters.memberIds === null) return o.members
    return o.members.filter((m) => filters.memberIds!.includes(m.id))
  }

  const nothingToShow = dayGroups.length === 0 && overdueItems.length === 0

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 [&>*]:shrink-0">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Chores</h1>
          <p className="text-muted-foreground text-sm">
            Tap the circle to mark a chore done.
          </p>
        </div>
        <ChoresViewSwitch familyId={familyId} value={view} onChange={setView} />
      </header>

      <ChoreFilterBar
        filters={filters}
        onChange={setFilters}
        members={members}
        routines={routines}
      />

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : nothingToShow ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
            <PartyPopperIcon className="size-6" />
          </div>
          <div>
            <p className="font-medium">
              {filtersActive(filters) ? "Nothing matches these filters" : "All clear"}
            </p>
            <p className="text-muted-foreground text-sm">
              {view === "today" ? "No chores left for today." : "No chores this week."}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {overdueItems.length > 0 && (
            <section className="flex flex-col gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
              <header className="flex items-center gap-2">
                <AlertTriangleIcon className="size-4 text-amber-600 dark:text-amber-400" />
                <h2 className="text-sm font-semibold">Missed ({overdueItems.length})</h2>
                <span className="text-muted-foreground ml-auto text-xs">Still not done</span>
                {canManage && (
                  <ClearMissedButton
                    familyId={familyId}
                    through={overdueTo}
                    count={overdueItems.length}
                  />
                )}
              </header>
              <ul className="flex flex-col gap-2">
                {overdueItems.map((o) => (
                  <ChoreListRow
                    key={`overdue-${o.task_id}-${o.occurrence_date}`}
                    occurrence={o}
                    // Show whoever still owes it (the filter already decided the row shows).
                    visibleMembers={o.members.filter(
                      (m) => !o.completed_member_ids.includes(m.id),
                    )}
                    routineName={o.routine_id ? routineName.get(o.routine_id) : undefined}
                    canManage={canManage}
                    allMembers={members}
                    canMove={movableByTaskId.get(o.task_id) ?? false}
                    today={today}
                    subLabel={dayLabel(o.occurrence_date, today)}
                    onToggle={(mid) => toggle(o, mid)}
                    onSwap={(mid) => swapTo(o, mid)}
                    onSkip={(scope) => skip(o, scope)}
                    onReset={() => resetRotation(o)}
                    onMoveToToday={() => moveToToday(o)}
                    canDefer={freqByTaskId.get(o.task_id) !== "daily"}
                    onDefer={() => deferOccurrence(o)}
                  />
                ))}
              </ul>
            </section>
          )}

          {dayGroups.map((g) => (
            <section key={g.date} className="flex flex-col gap-2">
              {(view === "week" || dayGroups.length > 1) && (
                <h2 className="font-heading text-muted-foreground text-sm font-semibold uppercase tracking-wide">
                  {dayLabel(g.date, today)}
                </h2>
              )}
              <ul className="flex flex-col gap-2">
                {g.items.map((o) => (
                  <ChoreListRow
                    key={`${o.task_id}-${o.occurrence_date}`}
                    occurrence={o}
                    visibleMembers={visibleMembersOf(o)}
                    routineName={o.routine_id ? routineName.get(o.routine_id) : undefined}
                    canManage={canManage}
                    allMembers={members}
                    canMove={movableByTaskId.get(o.task_id) ?? false}
                    today={today}
                    onToggle={(mid) => toggle(o, mid)}
                    onSwap={(mid) => swapTo(o, mid)}
                    onSkip={(scope) => skip(o, scope)}
                    onReset={() => resetRotation(o)}
                    onMoveToToday={() => moveToToday(o)}
                    canDefer={freqByTaskId.get(o.task_id) !== "daily"}
                    onDefer={() => deferOccurrence(o)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function ChoreListRow({
  occurrence: o,
  visibleMembers,
  routineName,
  canManage,
  allMembers,
  canMove,
  today,
  subLabel,
  onToggle,
  onSwap,
  onSkip,
  onReset,
  onMoveToToday,
  canDefer,
  onDefer,
}: {
  occurrence: TaskOccurrenceOut
  visibleMembers: MemberRow[]
  routineName?: string
  canManage: boolean
  allMembers: MemberRow[]
  canMove?: boolean
  today?: string
  subLabel?: string
  onToggle: (memberId: string) => void
  onSwap: (memberId: string) => void
  onSkip: (scope: "occurrence" | "turn") => void
  onReset: () => void
  onMoveToToday: () => void
  /** Offer "Do it tomorrow" (just this occurrence). False for a daily chore. */
  canDefer?: boolean
  onDefer?: () => void
}) {
  const isRotating = o.up_next != null
  // "Move to today" re-phases an interval chore to today; pointless on a today row.
  const showMove = !!canMove && o.occurrence_date !== today
  // Nothing to defer once someone has done it (the backend refuses too).
  const showDefer = !!canDefer && o.completed_member_ids.length === 0 && !o.is_skipped
  const deferLabel =
    today && o.occurrence_date < today ? "Do it today (just once)" : "Do it tomorrow"
  const showMenu = canManage && (isRotating || showMove || showDefer)
  const multiDayTurn = o.rotation_unit !== "occurrence" || o.rotation_interval > 1
  const swapTargets = allMembers.filter((m) => !o.members.some((mm) => mm.id === m.id))

  // "+N ★" feedback on completing (not on undoing).
  const [popKey, setPopKey] = useState(0)

  // One person on it: a big checkbox on the left finishes it for them (the face on the
  // right just says who). Several people: each face is its own checkbox, since the
  // chore has to be ticked off per person.
  const solo = !o.is_skipped && visibleMembers.length === 1 ? visibleMembers[0] : null
  const soloDone = solo ? o.completed_member_ids.includes(solo.id) : false
  const allDone = doneRank(o) === 1 && !o.is_skipped
  function press(memberId: string, done: boolean) {
    if (!done) setPopKey((k) => k + 1)
    onToggle(memberId)
  }

  return (
    <li
      className={cn(
        "bg-card ring-foreground/5 relative flex items-center gap-3 rounded-2xl border-l-4 p-3 shadow-sm ring-1 transition-opacity",
        allDone && "opacity-60",
      )}
      // The routine's color rides along the left edge.
      style={{ borderLeftColor: o.effective_color }}
    >
      <StarPop amount={o.star_value} popKey={popKey} />
      {solo && (
        <button
          type="button"
          onClick={() => press(solo.id, soloDone)}
          aria-pressed={soloDone}
          aria-label={`${soloDone ? "Undo" : "Mark"} ${o.title} done`}
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            "focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2",
            soloDone ? "text-white" : "hover:bg-muted/60",
          )}
          style={{
            borderColor: solo.color,
            backgroundColor: soloDone ? solo.color : undefined,
          }}
        >
          {soloDone && <CheckIcon className="size-5 animate-in zoom-in-50" />}
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-medium leading-tight",
            (o.is_skipped || allDone) && "text-muted-foreground line-through",
          )}
        >
          {o.icon && <span className="mr-1.5">{o.icon}</span>}
          {o.title}
        </p>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {subLabel && <span>{subLabel}</span>}
          {o.is_moved && o.moved_from && (
            <span className="inline-flex items-center gap-0.5">
              <CalendarClockIcon className="size-3" /> Moved from{" "}
              {dayLabel(o.moved_from, today ?? o.moved_from)}
            </span>
          )}
          {routineName && <span>{routineName}</span>}
          {o.star_value > 0 && (
            <span className="inline-flex items-center gap-0.5 text-amber-500">
              <StarIcon className="size-3 fill-amber-400 text-amber-400" />
              {o.star_value}
            </span>
          )}
        </div>
      </div>

      {/* Who it's for. With one person it's just a label; with several, each face is a
          checkbox: an empty ring until they've done it, a filled check after. */}
      <div className="flex items-center gap-1.5">
        {o.is_skipped ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <BanIcon className="size-3.5" /> Skipped
          </span>
        ) : visibleMembers.length === 0 ? (
          <span className="text-muted-foreground text-xs">Unassigned</span>
        ) : solo ? (
          <span
            title={solo.name}
            className="flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: solo.color }}
          >
            {initials(solo.name)}
          </span>
        ) : (
          visibleMembers.map((m) => {
            const done = o.completed_member_ids.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => press(m.id, done)}
                aria-pressed={done}
                aria-label={`${done ? "Undo" : "Mark"} ${o.title} done for ${m.name}`}
                title={m.name}
                className={cn(
                  "relative flex size-9 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all",
                  "focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2",
                  done ? "text-white" : "hover:bg-muted/60",
                )}
                style={{
                  borderColor: m.color,
                  backgroundColor: done ? m.color : undefined,
                  color: done ? undefined : m.color,
                }}
              >
                {done ? <CheckIcon className="size-5 animate-in zoom-in-50" /> : initials(m.name)}
              </button>
            )
          })
        )}

        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Options for ${o.title}`}
                className="text-muted-foreground hover:bg-muted/40 hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors"
              >
                <EllipsisVerticalIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {isRotating && (
                <>
                  {swapTargets.length > 0 && (
                    <>
                      <DropdownMenuLabel>Reassign</DropdownMenuLabel>
                      {swapTargets.map((m) => (
                        <DropdownMenuItem key={m.id} onClick={() => onSwap(m.id)}>
                          <ArrowLeftRightIcon /> Swap to {m.name}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={() => onSkip("occurrence")}>
                    <BanIcon /> Skip this one
                  </DropdownMenuItem>
                  {multiDayTurn && (
                    <DropdownMenuItem onClick={() => onSkip("turn")}>
                      <BanIcon /> Skip this whole turn
                    </DropdownMenuItem>
                  )}
                  {o.is_overridden && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onReset}>
                        <Undo2Icon /> Reset to rotation
                      </DropdownMenuItem>
                    </>
                  )}
                </>
              )}
              {showMove && (
                <>
                  {isRotating && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={onMoveToToday}>
                    <CalendarArrowDownIcon /> Move to today
                  </DropdownMenuItem>
                </>
              )}
              {showDefer && (
                <>
                  {(isRotating || showMove) && <DropdownMenuSeparator />}
                  <DropdownMenuItem onClick={onDefer}>
                    <CalendarClockIcon /> {deferLabel}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  )
}
