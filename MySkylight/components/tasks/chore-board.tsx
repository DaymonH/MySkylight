"use client"

import { useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  BanIcon,
  CalendarArrowDownIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  ListChecksIcon,
  Loader2Icon,
  PartyPopperIcon,
  RepeatIcon,
  StarIcon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import { useStarBalances } from "@/hooks/use-rewards"
import { useTodayYMD } from "@/hooks/use-today"
import {
  useCompleteTask,
  useClearRotationOverride,
  useMoveTaskToToday,
  useRoutines,
  useSetRotationOverride,
  useTasks,
  useTaskOccurrences,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ChoreFilterBar } from "@/components/tasks/chore-filter-bar"
import { ClearMissedButton } from "@/components/tasks/clear-missed-button"
import { StarPop } from "@/components/tasks/star-pop"
import { cn } from "@/lib/utils"
import { isDefiniteClientError } from "@/lib/api-client"
import { routineAccent } from "@/lib/colors"
import {
  type ChoreFilters,
  DEFAULT_FILTERS,
  addDaysYMD,
  applyFilters,
  dayLabel,
  dayStripLabel,
  filtersActive,
  formatMinutesTotal,
  MISSED_LOOKBACK_DAYS,
  isOverdue,
  matchesStatus,
  matchesStatusForMember,
  relativeWeekLabel,
  weekDatesYMD,
  weekRangeLabel,
  weekRangeYMD,
  withinMissedWindow,
  type CompletionStatus,
} from "@/lib/chores"
import { canRephase, classifyFrequency, type ChoreFrequency } from "@/lib/recurrence"
import { bucketLabel } from "@/components/tasks/time-wheel"
import type { MemberBrief } from "@/lib/types/calendar"
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

const ANYTIME_KEY = "__anytime__"

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

/** A task occurrence grouped under a routine (or "Anytime" for ungrouped). */
interface RoutineGroup {
  key: string
  name: string
  items: TaskOccurrenceOut[]
}

/**
 * Bucket occurrences by routine, in routine sort order with "Anytime" (ungrouped)
 * last. Shared by the Today cards and the Week columns so both read routine
 * membership the same way. Items within a group sort by title.
 */
function groupByRoutine(
  items: TaskOccurrenceOut[],
  routineOrder: Map<string, { name: string; sort: number }>,
): RoutineGroup[] {
  const byRoutine = new Map<string, TaskOccurrenceOut[]>()
  for (const o of items) {
    const key = o.routine_id ?? ANYTIME_KEY
    const list = byRoutine.get(key) ?? []
    list.push(o)
    byRoutine.set(key, list)
  }
  return [...byRoutine.entries()]
    .map(([key, list]) => ({
      key,
      name: key === ANYTIME_KEY ? "Anytime" : (routineOrder.get(key)?.name ?? "Routine"),
      items: list.sort((a, b) => a.title.localeCompare(b.title)),
      sort: key === ANYTIME_KEY ? Number.MAX_SAFE_INTEGER : (routineOrder.get(key)?.sort ?? 0),
    }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ key, name, items }) => ({ key, name, items }))
}

/** Accent color for a routine group key (ANYTIME_KEY → neutral "Anytime" gray). */
function accentForGroup(key: string): string {
  return routineAccent(key === ANYTIME_KEY ? null : key)
}

/** Small routine label: a color dot + name, the "which routine?" cue that pairs
 *  with the member-colored checkbox's "whose chore?" cue. */
function RoutineHeader({ name, color }: { name: string; color: string }) {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </p>
  )
}

/**
 * The device "chores" surface: per-member cards with big, satisfying tap targets.
 * Defaults to today; a Today/Week toggle adds a day strip so the family can see
 * what's due which day. A persistent "Missed" section surfaces un-done chores from
 * previous days, and a filter bar narrows by status / person / routine / frequency.
 *
 * Tapping a chore toggles completion for that member on *that occurrence's* date
 * (so a missed Tuesday chore completes against Tuesday) — optimistic, with other
 * screens catching up over SSE.
 */
export function ChoreBoard({ familyId }: { familyId: string }) {
  useRealtime(familyId)

  const api = useApi()
  // Rolls over at midnight on its own — the wall display never reloads.
  const today = useTodayYMD()

  const [view, setView] = useState<"today" | "week">("today")
  // Whole-week offset from the current week (0 = this week, 1 = next, -1 = last).
  const [weekOffset, setWeekOffset] = useState(0)
  const [filters, setFilters] = useState<ChoreFilters>(DEFAULT_FILTERS)

  // The week currently in view (shifted by the prev/next buttons).
  const weekAnchor = addDaysYMD(today, weekOffset * 7)
  const week = weekRangeYMD(weekAnchor)
  const weekDates = weekDatesYMD(weekAnchor)
  // Main window: just today, or the whole viewed week.
  const mainFrom = view === "today" ? today : week.start
  const mainTo = view === "today" ? today : week.end
  // "Missed" only makes sense relative to today: it's un-done chores from *before*
  // the main window. We show it in day view and on the current week, but not when
  // paging to other weeks (a future week has nothing to "miss" yet).
  const showMissed = view === "today" || weekOffset === 0
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
  const { data: pastOccs = [] } = useTaskOccurrences(
    familyId,
    overdueFrom,
    overdueTo,
    showMissed,
  )

  // Spendable stars per member, shown on each person's card. Kept fresh by the
  // `task.*` / `reward.*` realtime events (they invalidate ["star-balances", …]).
  const { data: balances = [] } = useStarBalances(familyId)
  const starsByMember = useMemo(
    () => new Map(balances.map((b) => [b.member_id, b.available])),
    [balances],
  )

  const complete = useCompleteTask(familyId)
  const uncomplete = useUncompleteTask(familyId)
  const setOverride = useSetRotationOverride(familyId)
  const clearOverride = useClearRotationOverride(familyId)
  const moveTask = useMoveTaskToToday(familyId)

  // Reassigning/skipping a turn is an owner/adult action (kids can't dodge chores).
  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const role = memberships.find((m) => m.family_id === familyId)?.role
  const canManage = role === "owner" || role === "adult"

  // task_id → coarse frequency, for the "Repeat" filter (occurrences don't carry the rrule).
  const freqByTaskId = useMemo(
    () => new Map<string, ChoreFrequency>(tasks.map((t) => [t.id, classifyFrequency(t.rrule)])),
    [tasks],
  )

  // task_id → estimated minutes (F30). Occurrences don't carry the estimate, so we
  // join it from the task list to show each chore's time bucket on its card.
  const minutesByTaskId = useMemo(
    () => new Map<string, number | null>(tasks.map((t) => [t.id, t.estimated_minutes])),
    [tasks],
  )

  // task_id → can "Move to today" re-phase it? Only interval-style recurring chores
  // (not BYDAY-pinned). Occurrences don't carry the rrule, so join from the task list.
  const movableByTaskId = useMemo(
    () => new Map<string, boolean>(tasks.map((t) => [t.id, canRephase(t.rrule)])),
    [tasks],
  )

  // routine_id → sort_order, so cards group chores in routine order ("Anytime" last).
  const routineOrder = useMemo(() => {
    const m = new Map<string, { name: string; sort: number }>()
    routines.forEach((r) => m.set(r.id, { name: r.name, sort: r.sort_order }))
    return m
  }, [routines])

  // Apply person/routine/frequency filters once; status is applied per-member below.
  const filteredMain = useMemo(
    () => applyFilters(mainOccs, filters, freqByTaskId),
    [mainOccs, filters, freqByTaskId],
  )
  // Today view pins to today's chores (the rich per-member cards).
  const dayOccs = useMemo(
    () => filteredMain.filter((o) => o.occurrence_date === today),
    [filteredMain, today],
  )

  // Week view: every day's chores bucketed by date, so all seven show at once.
  const occsByDate = useMemo(() => {
    const m = new Map<string, TaskOccurrenceOut[]>()
    for (const d of weekDatesYMD(week.start)) m.set(d, [])
    for (const o of filteredMain) m.get(o.occurrence_date)?.push(o)
    return m
  }, [filteredMain, week.start])

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

  // Cards: one per member with ≥1 chore on the active day (after the status filter).
  const memberCards = members
    .map((m) => ({
      member: m,
      items: dayOccs.filter(
        (o) =>
          o.members.some((mm) => mm.id === m.id) &&
          matchesStatusForMember(o, m.id, filters.status),
      ),
    }))
    .filter((c) => c.items.length > 0)

  // Skipped ("not my week") occurrences are excused — no one's on the hook.
  const skippedItems = dayOccs.filter((o) => o.is_skipped)
  // Unassigned chores can't be checked off per-member — surface them so they don't vanish.
  const unassigned = dayOccs.filter((o) => o.members.length === 0 && !o.is_skipped)

  function toggle(o: TaskOccurrenceOut, memberId: string, done: boolean) {
    const vars = { taskId: o.task_id, memberId, occurrenceDate: o.occurrence_date }
    if (done) uncomplete.mutate(vars)
    else complete.mutate(vars)
  }
  // Only alert on a *definitive* rejection (4xx). Transport hiccups over the home
  // link are retried in the hook and reconciled via SSE/refetch, so surfacing them
  // would cry wolf on writes that actually landed ("failed… then it worked").
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
  // Re-anchor the chore's recurrence to today (its cadence re-phases from today) and
  // complete it today for `memberId` — one tap resolves a missed chore you did today
  // without it nagging you again too soon.
  function moveToToday(o: TaskOccurrenceOut, memberId: string) {
    moveTask.mutate(
      { taskId: o.task_id, memberId },
      {
        onError: (err) => {
          if (isDefiniteClientError(err)) toast.error("Couldn't move this chore.")
        },
      },
    )
  }

  const heading =
    view === "today"
      ? new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
      : `${relativeWeekLabel(weekOffset)} · ${weekRangeLabel(week.start, week.end)}`

  // In week view the whole week is the body, so it's empty only when no day has
  // anything; in today view it's the today cards plus the Missed section.
  const bodyEmpty =
    view === "today"
      ? memberCards.length === 0 && unassigned.length === 0 && skippedItems.length === 0
      : filteredMain.length === 0
  const nothingToShow = bodyEmpty && overdueItems.length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <ListChecksIcon className="size-6" />
        </span>
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Chores</h1>
          <p className="text-muted-foreground text-sm">{heading}</p>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => {
            if (!v) return
            setView(v as "today" | "week")
            setWeekOffset(0) // always re-anchor on the current week when toggling
          }}
        >
          <ToggleGroupItem value="today">Today</ToggleGroupItem>
          <ToggleGroupItem value="week">Week</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5">
        <ChoreFilterBar
          filters={filters}
          onChange={setFilters}
          members={members}
          routines={routines}
        />
      </div>

      {view === "week" && (
        <div className="flex items-center gap-2 border-b px-5 py-2.5">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label="Previous week"
            className="text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-ring/40 flex size-9 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label="Next week"
            className="text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-ring/40 flex size-9 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2"
          >
            <ChevronRightIcon className="size-5" />
          </button>
          <p className="font-medium">
            {relativeWeekLabel(weekOffset)}
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {weekRangeLabel(week.start, week.end)}
            </span>
          </p>
          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="text-primary hover:bg-primary/10 ml-auto rounded-xl px-3 py-1.5 text-sm font-medium transition-colors"
            >
              This week
            </button>
          )}
        </div>
      )}

      <div className="thin-scrollbar flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
            <Loader2Icon className="size-5 animate-spin" />
            Loading chores…
          </div>
        ) : nothingToShow ? (
          <EmptyState filtered={filtersActive(filters)} />
        ) : (
          <div className="flex flex-col gap-4">
            {overdueItems.length > 0 && (
              <OverdueSection
                familyId={familyId}
                clearThrough={overdueTo}
                items={overdueItems}
                members={members}
                today={today}
                canManage={canManage}
                minutesByTaskId={minutesByTaskId}
                movableByTaskId={movableByTaskId}
                onToggle={toggle}
                onSwap={swapTo}
                onSkip={skip}
                onReset={resetRotation}
                onMoveToToday={moveToToday}
              />
            )}

            {view === "today" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {memberCards.map(({ member, items }) => {
                const groups = groupByRoutine(items, routineOrder)
                const doneCount = items.filter((o) =>
                  o.completed_member_ids.includes(member.id),
                ).length
                const allDone = doneCount === items.length
                // Per-person daily load (F30 aggregate): total estimated time across
                // this member's chores today, regardless of done state.
                const totalLabel = formatMinutesTotal(
                  items.reduce((sum, o) => sum + (minutesByTaskId.get(o.task_id) ?? 0), 0),
                )

                return (
                  <section
                    key={member.id}
                    className="bg-card ring-foreground/5 flex flex-col gap-4 rounded-3xl p-5 shadow-sm ring-1"
                  >
                    <header className="flex items-center gap-3">
                      <span
                        className="flex size-12 items-center justify-center rounded-full text-lg font-semibold text-white"
                        style={{ backgroundColor: member.color }}
                      >
                        {initials(member.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-lg font-semibold leading-tight">{member.name}</p>
                        <p className="text-muted-foreground text-sm">
                          {totalLabel && (
                            <span className="inline-flex items-center gap-1">
                              <ClockIcon className="size-3.5" />
                              {totalLabel}
                              <span className="mx-1.5 opacity-40">·</span>
                            </span>
                          )}
                          {doneCount} / {items.length} done
                        </p>
                      </div>
                      {starsByMember.has(member.id) && (
                        <span
                          className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-base font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                          title="Stars available to spend"
                        >
                          <StarIcon className="size-4 fill-amber-400 text-amber-400" />
                          {starsByMember.get(member.id)}
                        </span>
                      )}
                      {allDone && (
                        <span className="text-2xl" role="img" aria-label="All done">
                          🎉
                        </span>
                      )}
                    </header>

                    <div className="flex flex-col gap-3">
                      {groups.map((g) => {
                        const accent = accentForGroup(g.key)
                        // Show the routine header whenever it carries information: any
                        // time there's more than one group, or the lone group is a real
                        // routine (not the catch-all "Anytime").
                        const showHeader = groups.length > 1 || g.key !== ANYTIME_KEY
                        return (
                        <div key={g.key} className="flex flex-col gap-1.5">
                          {showHeader && <RoutineHeader name={g.name} color={accent} />}
                          <ul
                            className={cn("flex flex-col gap-2", showHeader && "border-l-2 pl-3")}
                            style={showHeader ? { borderLeftColor: accent } : undefined}
                          >
                            {g.items.map((o) => {
                              const done = o.completed_member_ids.includes(member.id)
                              return (
                                <li key={o.task_id}>
                                  <ChoreRow
                                    occurrence={o}
                                    currentMemberId={member.id}
                                    allMembers={members}
                                    canManage={canManage}
                                    done={done}
                                    minutes={minutesByTaskId.get(o.task_id) ?? null}
                                    canMove={movableByTaskId.get(o.task_id) ?? false}
                                    today={today}
                                    onToggle={() => toggle(o, member.id, done)}
                                    onSwap={(mid) => swapTo(o, mid)}
                                    onSkip={(scope) => skip(o, scope)}
                                    onReset={() => resetRotation(o)}
                                    onMoveToToday={() => moveToToday(o, member.id)}
                                  />
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}

              {unassigned.length > 0 && (
                <section className="border-muted-foreground/20 flex flex-col gap-3 rounded-3xl border border-dashed p-5">
                  <header>
                    <p className="text-lg font-semibold leading-tight">Unassigned</p>
                    <p className="text-muted-foreground text-sm">
                      Assign these to a member to check off.
                    </p>
                  </header>
                  <ul className="flex flex-col gap-2">
                    {unassigned.map((o) => (
                      <li
                        key={o.task_id}
                        className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                      >
                        <span
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: o.effective_color }}
                        />
                        <span className="text-muted-foreground truncate">{o.title}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {skippedItems.length > 0 && (
                <section className="border-muted-foreground/20 flex flex-col gap-3 rounded-3xl border border-dashed p-5">
                  <header>
                    <p className="text-lg font-semibold leading-tight">Skipped</p>
                    <p className="text-muted-foreground text-sm">
                      Excused — no one&apos;s on the hook.
                    </p>
                  </header>
                  <ul className="flex flex-col gap-2">
                    {skippedItems.map((o) => (
                      <li
                        key={o.task_id}
                        className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                      >
                        <BanIcon className="text-muted-foreground size-4 shrink-0" />
                        <span className="text-muted-foreground flex-1 truncate line-through">
                          {o.title}
                        </span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => resetRotation(o)}
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
                          >
                            <Undo2Icon className="size-3.5" /> Restore
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            ) : (
              <WeekGrid
                weekDates={weekDates}
                today={today}
                occsByDate={occsByDate}
                members={members}
                status={filters.status}
                routineOrder={routineOrder}
                minutesByTaskId={minutesByTaskId}
                movableByTaskId={movableByTaskId}
                canManage={canManage}
                onToggle={toggle}
                onSwap={swapTo}
                onSkip={skip}
                onReset={resetRotation}
                onMoveToToday={moveToToday}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-2xl">
        <PartyPopperIcon className="size-8" />
      </span>
      <div>
        <p className="font-heading text-xl font-semibold">
          {filtered ? "No chores match these filters" : "No chores here"}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {filtered
            ? "Try clearing a filter to see more."
            : "Add chores from the companion app to see them here."}
        </p>
      </div>
    </div>
  )
}

/** The "Missed" section: un-done chores from earlier days, grouped under one card. */
function OverdueSection({
  familyId,
  clearThrough,
  items,
  members,
  today,
  canManage,
  minutesByTaskId,
  movableByTaskId,
  onToggle,
  onSwap,
  onSkip,
  onReset,
  onMoveToToday,
}: {
  familyId: string
  /** Last day (YYYY-MM-DD) that "Clear" dismisses — the day before this section's anchor. */
  clearThrough: string
  items: TaskOccurrenceOut[]
  members: MemberRow[]
  today: string
  canManage: boolean
  minutesByTaskId: Map<string, number | null>
  movableByTaskId: Map<string, boolean>
  onToggle: (o: TaskOccurrenceOut, memberId: string, done: boolean) => void
  onSwap: (o: TaskOccurrenceOut, memberId: string) => void
  onSkip: (o: TaskOccurrenceOut, scope: "occurrence" | "turn") => void
  onReset: (o: TaskOccurrenceOut) => void
  onMoveToToday: (o: TaskOccurrenceOut, memberId: string) => void
}) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-amber-300/60 bg-amber-50 p-5 dark:border-amber-900/50 dark:bg-amber-950/30">
      <header className="flex items-center gap-2">
        <AlertTriangleIcon className="size-5 text-amber-600 dark:text-amber-400" />
        <p className="text-lg font-semibold leading-tight">Missed ({items.length})</p>
        <p className="text-muted-foreground ml-auto text-sm">From earlier days — still not done.</p>
        {canManage && (
          <ClearMissedButton familyId={familyId} through={clearThrough} count={items.length} />
        )}
      </header>
      <ul className="flex flex-col gap-2">
        {items.map((o) => {
          // Show one row per still-pending assignee so the right person can clear it.
          const pending = o.members.filter((m) => !o.completed_member_ids.includes(m.id))
          return pending.map((m) => (
            <li key={`${o.task_id}:${m.id}`}>
              <ChoreRow
                occurrence={o}
                currentMemberId={m.id}
                allMembers={members}
                canManage={canManage}
                done={false}
                minutes={minutesByTaskId.get(o.task_id) ?? null}
                canMove={movableByTaskId.get(o.task_id) ?? false}
                today={today}
                dateLabel={`${m.name} · ${dayLabel(o.occurrence_date, today)}`}
                onToggle={() => onToggle(o, m.id, false)}
                onSwap={(mid) => onSwap(o, mid)}
                onSkip={(scope) => onSkip(o, scope)}
                onReset={() => onReset(o)}
                onMoveToToday={() => onMoveToToday(o, m.id)}
              />
            </li>
          ))
        })}
      </ul>
    </section>
  )
}

function ChoreRow({
  occurrence,
  currentMemberId,
  allMembers,
  canManage,
  done,
  minutes,
  canMove,
  today,
  dateLabel,
  onToggle,
  onSwap,
  onSkip,
  onReset,
  onMoveToToday,
}: {
  occurrence: TaskOccurrenceOut
  currentMemberId: string
  allMembers: MemberRow[]
  canManage: boolean
  done: boolean
  /** Estimated time bucket (F30), shown as a chip; null when no estimate is set. */
  minutes: number | null
  /** Interval-style recurring chore whose cadence can re-phase to today (F01). */
  canMove?: boolean
  /** Today's YMD — "Move to today" is hidden on an occurrence that's already today. */
  today?: string
  /** Optional sub-label (used by the Missed section to show who/when). */
  dateLabel?: string
  onToggle: () => void
  onSwap: (memberId: string) => void
  onSkip: (scope: "occurrence" | "turn") => void
  onReset: () => void
  onMoveToToday: () => void
}) {
  const { title, effective_color: color, up_next: upNext } = occurrence
  const style: CSSProperties = done
    ? { backgroundColor: color, borderColor: color }
    : { borderColor: color }

  // up_next is set only for a rotating chore with ≥2 members — exactly when a
  // swap/skip makes sense. A multi-day turn (e.g. a weekly owner) also offers
  // "skip the whole turn".
  const isRotating = upNext != null
  // "Move to today" re-phases an interval chore to today; pointless on an
  // occurrence that's already today (no shift), so hide it there.
  const showMove = !!canMove && occurrence.occurrence_date !== today
  const showMenu = canManage && (isRotating || showMove)
  const multiDayTurn =
    occurrence.rotation_unit !== "occurrence" || occurrence.rotation_interval > 1
  const swapTargets = allMembers.filter((m) => m.id !== currentMemberId)

  // "+N ★" feedback on completing (not on undoing). Optimistic, like the check itself.
  const [popKey, setPopKey] = useState(0)
  const stars = occurrence.star_value

  return (
    <div className="relative flex items-stretch gap-1.5">
      <StarPop amount={stars} popKey={popKey} />
      <button
        type="button"
        onClick={() => {
          if (!done) setPopKey((k) => k + 1)
          onToggle()
        }}
        aria-pressed={done}
        className={cn(
          "flex flex-1 items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors",
          "focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-2",
          done ? "bg-muted/50" : "hover:bg-muted/40",
        )}
      >
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border-2 transition-all"
          style={style}
        >
          {done && <CheckIcon className="size-5 text-white duration-200 animate-in zoom-in-50" />}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-lg font-medium transition-all",
              done && "text-muted-foreground line-through",
            )}
          >
            {title}
          </span>
          {dateLabel ? (
            <span className="text-muted-foreground mt-0.5 block text-xs">{dateLabel}</span>
          ) : occurrence.is_overridden && !done ? (
            <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
              <ArrowLeftRightIcon className="size-3" /> Swapped in
            </span>
          ) : upNext && !done ? (
            <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
              <RepeatIcon className="size-3" /> Next: {upNext.name}
            </span>
          ) : null}
        </span>
        {stars > 0 && (
          <span
            className={cn(
              "flex shrink-0 items-center gap-0.5 text-sm font-semibold text-amber-600 dark:text-amber-400",
              done && "opacity-40",
            )}
            title={`${stars} star${stars === 1 ? "" : "s"}`}
          >
            <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
            {stars}
          </span>
        )}
        {minutes != null && minutes > 0 && (
          <span
            className={cn(
              "text-muted-foreground flex shrink-0 items-center gap-1 text-xs font-medium",
              done && "opacity-40",
            )}
          >
            <ClockIcon className="size-3.5" />
            {bucketLabel(minutes)}
          </span>
        )}
      </button>

      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${title}`}
              className="text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-ring/40 flex items-center justify-center rounded-2xl border px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2"
            >
              <EllipsisVerticalIcon className="size-5" />
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
                {occurrence.is_overridden && (
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/**
 * Week view: a column per day so the whole week is visible at once (no tab-per-day).
 * Each column lists that day's chores as compact, tap-to-complete rows — one row per
 * assigned member, so you can see who's on the hook and check off your own. Swap/skip
 * stays on the Today view and the companion app, keeping the dense grid readable.
 */
function WeekGrid({
  weekDates,
  today,
  occsByDate,
  members,
  status,
  routineOrder,
  minutesByTaskId,
  movableByTaskId,
  canManage,
  onToggle,
  onSwap,
  onSkip,
  onReset,
  onMoveToToday,
}: {
  weekDates: string[]
  today: string
  occsByDate: Map<string, TaskOccurrenceOut[]>
  members: MemberRow[]
  status: CompletionStatus
  routineOrder: Map<string, { name: string; sort: number }>
  minutesByTaskId: Map<string, number | null>
  movableByTaskId: Map<string, boolean>
  canManage: boolean
  onToggle: (o: TaskOccurrenceOut, memberId: string, done: boolean) => void
  onSwap: (o: TaskOccurrenceOut, memberId: string) => void
  onSkip: (o: TaskOccurrenceOut, scope: "occurrence" | "turn") => void
  onReset: (o: TaskOccurrenceOut) => void
  onMoveToToday: (o: TaskOccurrenceOut, memberId: string) => void
}) {
  return (
    // 1 column stacked on narrow screens, a clean 7-across week on tablet/kiosk
    // widths. 7 is prime, so any in-between count would wrap to a lonely cell.
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-7">
      {weekDates.map((date) => (
        <WeekDayColumn
          key={date}
          date={date}
          today={today}
          items={occsByDate.get(date) ?? []}
          members={members}
          status={status}
          routineOrder={routineOrder}
          minutesByTaskId={minutesByTaskId}
          movableByTaskId={movableByTaskId}
          canManage={canManage}
          onToggle={onToggle}
          onSwap={onSwap}
          onSkip={onSkip}
          onReset={onReset}
          onMoveToToday={onMoveToToday}
        />
      ))}
    </div>
  )
}

function WeekDayColumn({
  date,
  today,
  items,
  members,
  status,
  routineOrder,
  minutesByTaskId,
  movableByTaskId,
  canManage,
  onToggle,
  onSwap,
  onSkip,
  onReset,
  onMoveToToday,
}: {
  date: string
  today: string
  items: TaskOccurrenceOut[]
  members: MemberRow[]
  status: CompletionStatus
  routineOrder: Map<string, { name: string; sort: number }>
  minutesByTaskId: Map<string, number | null>
  movableByTaskId: Map<string, boolean>
  canManage: boolean
  onToggle: (o: TaskOccurrenceOut, memberId: string, done: boolean) => void
  onSwap: (o: TaskOccurrenceOut, memberId: string) => void
  onSkip: (o: TaskOccurrenceOut, scope: "occurrence" | "turn") => void
  onReset: (o: TaskOccurrenceOut) => void
  onMoveToToday: (o: TaskOccurrenceOut, memberId: string) => void
}) {
  const isToday = date === today
  const { dow, day } = dayStripLabel(date)

  // Cluster the day's assigned chores by routine ("Anytime" last) so a column
  // shared by several people still reads which routine each chore belongs to.
  const assigned = items.filter((o) => o.members.length > 0 && !o.is_skipped)
  const assignedGroups = groupByRoutine(assigned, routineOrder)
  const unassigned = [...items]
    .filter((o) => o.members.length === 0 && !o.is_skipped)
    .sort((a, b) => a.title.localeCompare(b.title))
  const skipped = [...items]
    .filter((o) => o.is_skipped)
    .sort((a, b) => a.title.localeCompare(b.title))
  const isEmpty = assigned.length === 0 && unassigned.length === 0 && skipped.length === 0

  // done/total over assigned member-rows, ignoring the status filter (so the count
  // reflects the day's whole load even when filtered to "to-do" or "done").
  let total = 0
  let done = 0
  for (const o of assigned) {
    for (const m of o.members) {
      total += 1
      if (o.completed_member_ids.includes(m.id)) done += 1
    }
  }

  // Per-person daily load (F30 aggregate): summed estimated time each member is on
  // the hook for this day, ignoring the status filter. Shown as a footer so the
  // day's cleaning time splits across people are visible at a glance.
  const minutesByMember = new Map<string, number>()
  for (const o of assigned) {
    const mins = minutesByTaskId.get(o.task_id) ?? 0
    if (mins <= 0) continue
    for (const m of o.members) {
      minutesByMember.set(m.id, (minutesByMember.get(m.id) ?? 0) + mins)
    }
  }
  const memberTimes = members
    .map((m) => ({ member: m, minutes: minutesByMember.get(m.id) ?? 0 }))
    .filter((x) => x.minutes > 0)

  return (
    <section
      className={cn(
        "bg-card ring-foreground/5 flex min-w-0 flex-col gap-2 rounded-2xl p-3 shadow-sm ring-1",
        isToday && "ring-primary/50 ring-2",
      )}
    >
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground text-xs font-medium uppercase">{dow}</span>
          <span className={cn("text-lg font-semibold leading-none", isToday && "text-primary")}>
            {day}
          </span>
        </div>
        <span className="text-muted-foreground text-[11px]">
          {total === 0 ? "—" : `${done}/${total}`}
        </span>
      </header>

      {isEmpty ? (
        <p className="text-muted-foreground/50 py-3 text-center text-xs">Nothing</p>
      ) : (
        <div className="flex flex-col gap-2">
          {assignedGroups.map((g) => {
            // One row per still-relevant assignee, after the status filter.
            const rows = g.items.flatMap((o) =>
              o.members
                .filter((m) => matchesStatusForMember(o, m.id, status))
                .map((m) => ({ o, m })),
            )
            if (rows.length === 0) return null
            const accent = accentForGroup(g.key)
            const showHeader = assignedGroups.length > 1 || g.key !== ANYTIME_KEY
            return (
              <div key={g.key} className="flex flex-col gap-1.5">
                {showHeader && <RoutineHeader name={g.name} color={accent} />}
                <ul
                  className={cn("flex flex-col gap-1.5", showHeader && "border-l-2 pl-2")}
                  style={showHeader ? { borderLeftColor: accent } : undefined}
                >
                  {rows.map(({ o, m }) => {
                    const isDone = o.completed_member_ids.includes(m.id)
                    return (
                      <li key={`${o.task_id}:${m.id}`}>
                        <WeekChoreRow
                          occurrence={o}
                          member={m}
                          allMembers={members}
                          canManage={canManage}
                          done={isDone}
                          minutes={minutesByTaskId.get(o.task_id) ?? null}
                          canMove={movableByTaskId.get(o.task_id) ?? false}
                          today={today}
                          onToggle={() => onToggle(o, m.id, isDone)}
                          onSwap={(mid) => onSwap(o, mid)}
                          onSkip={(scope) => onSkip(o, scope)}
                          onReset={() => onReset(o)}
                          onMoveToToday={() => onMoveToToday(o, m.id)}
                        />
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}

          {(unassigned.length > 0 || skipped.length > 0) && (
            <ul className="flex flex-col gap-1.5">
              {unassigned.map((o) => (
                <li
                  key={o.task_id}
                  className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: o.effective_color }}
                  />
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                    {o.title}
                  </span>
                </li>
              ))}
              {skipped.map((o) => (
                <li
                  key={o.task_id}
                  className="flex items-center gap-2 rounded-xl border border-dashed px-2.5 py-1.5"
                >
                  <BanIcon className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm line-through">
                    {o.title}
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => onReset(o)}
                      aria-label={`Restore ${o.title}`}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <Undo2Icon className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {memberTimes.length > 0 && (
            <footer className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-1 border-t pt-2 text-[11px]">
              {memberTimes.map(({ member, minutes }) => (
                <span
                  key={member.id}
                  className="flex items-center gap-1"
                  title={`${member.name}: ${formatMinutesTotal(minutes)} of chores`}
                >
                  <span className="font-semibold" style={{ color: member.color }}>
                    {initials(member.name)}
                  </span>
                  <span className="text-muted-foreground">{formatMinutesTotal(minutes)}</span>
                </span>
              ))}
            </footer>
          )}
        </div>
      )}
    </section>
  )
}

/** One compact, tap-to-complete chore row in the week grid (one per assignee), with
 *  a 3-dot menu for swap/skip/reset (shown for rotating chores when the user can manage). */
function WeekChoreRow({
  occurrence,
  member,
  allMembers,
  canManage,
  done,
  minutes,
  canMove,
  today,
  onToggle,
  onSwap,
  onSkip,
  onReset,
  onMoveToToday,
}: {
  occurrence: TaskOccurrenceOut
  member: MemberBrief
  allMembers: MemberRow[]
  canManage: boolean
  done: boolean
  minutes: number | null
  canMove?: boolean
  today?: string
  onToggle: () => void
  onSwap: (memberId: string) => void
  onSkip: (scope: "occurrence" | "turn") => void
  onReset: () => void
  onMoveToToday: () => void
}) {
  const { title, up_next: upNext } = occurrence
  // The box doubles as the checkbox and the "who" cue: the assignee's initials in
  // their colour until done, then a check.
  const box: CSSProperties = done
    ? { backgroundColor: member.color, borderColor: member.color }
    : { borderColor: member.color, color: member.color }
  const hasMeta = minutes != null && minutes > 0

  // Same swap/skip affordance as the Today view: only for a rotating chore (up_next
  // set) and only for owners/adults. A multi-day turn also offers "skip the turn".
  // "Move to today" additionally shows for a movable interval chore on a non-today day.
  const isRotating = upNext != null
  const showMove = !!canMove && occurrence.occurrence_date !== today
  const showMenu = canManage && (isRotating || showMove)
  const multiDayTurn =
    occurrence.rotation_unit !== "occurrence" || occurrence.rotation_interval > 1
  const swapTargets = allMembers.filter((m) => m.id !== member.id)

  return (
    <div className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        title={title}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors",
          "focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-2",
          done ? "bg-muted/40" : "hover:bg-muted/40",
        )}
      >
        <span
          className="flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-[10px] font-bold transition-all"
          style={box}
        >
          {done ? <CheckIcon className="size-3.5 text-white" /> : initials(member.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-medium",
              done && "text-muted-foreground line-through",
            )}
          >
            {title}
          </span>
          {hasMeta && (
            <span className="text-muted-foreground mt-0.5 flex items-center gap-0.5 text-[11px]">
              <ClockIcon className="size-3" />
              {bucketLabel(minutes)}
            </span>
          )}
        </span>
      </button>

      {showMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${title}`}
              className="text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:ring-ring/40 flex shrink-0 items-center justify-center rounded-xl border px-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2"
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
                {occurrence.is_overridden && (
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
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
