"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  ArrowLeftRightIcon,
  BanIcon,
  CheckIcon,
  EllipsisVerticalIcon,
  PartyPopperIcon,
  PencilIcon,
  StarIcon,
  Undo2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import {
  useClearRotationOverride,
  useCompleteTask,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ChoreFilterBar } from "@/components/tasks/chore-filter-bar"
import { cn } from "@/lib/utils"
import {
  type ChoreFilters,
  DEFAULT_FILTERS,
  addDaysYMD,
  applyFilters,
  dayLabel,
  filtersActive,
  isOverdue,
  matchesStatus,
  todayYMD,
  weekDatesYMD,
  weekRangeYMD,
} from "@/lib/chores"
import { classifyFrequency, type ChoreFrequency } from "@/lib/recurrence"
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

const OVERDUE_LOOKBACK_DAYS = 14

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
  const today = todayYMD()

  const [view, setView] = useState<"today" | "week">("today")
  const [filters, setFilters] = useState<ChoreFilters>(DEFAULT_FILTERS)

  const week = weekRangeYMD(today)
  const mainFrom = view === "today" ? today : week.start
  const mainTo = view === "today" ? today : week.end
  const overdueAnchor = view === "today" ? today : week.start
  const overdueFrom = addDaysYMD(overdueAnchor, -OVERDUE_LOOKBACK_DAYS)
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
          .sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .filter((g) => g.items.length > 0)
  }, [view, filteredMain, today])

  const overdueItems = useMemo(
    () =>
      applyFilters(pastOccs, filters, freqByTaskId)
        .filter((o) => isOverdue(o, overdueAnchor) && matchesStatus(o, filters.status))
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
  function swapTo(o: TaskOccurrenceOut, memberId: string) {
    setOverride.mutate(
      { taskId: o.task_id, occurrenceDate: o.occurrence_date, memberId, scope: "occurrence" },
      { onError: () => toast.error("Couldn't reassign this chore.") },
    )
  }
  function skip(o: TaskOccurrenceOut, scope: "occurrence" | "turn") {
    setOverride.mutate(
      { taskId: o.task_id, occurrenceDate: o.occurrence_date, memberId: null, scope },
      { onError: () => toast.error("Couldn't skip this chore.") },
    )
  }
  function resetRotation(o: TaskOccurrenceOut) {
    clearOverride.mutate(
      { taskId: o.task_id, occurrenceDate: o.occurrence_date, scope: "occurrence" },
      { onError: () => toast.error("Couldn't reset this chore.") },
    )
  }

  // When a member filter is active, only show the avatars that pass it.
  function visibleMembersOf(o: TaskOccurrenceOut) {
    if (filters.memberIds === null) return o.members
    return o.members.filter((m) => filters.memberIds!.includes(m.id))
  }

  const nothingToShow = dayGroups.length === 0 && overdueItems.length === 0

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="font-heading text-xl font-semibold tracking-tight">Chores</h1>
          <p className="text-muted-foreground text-sm">
            Everyone&apos;s chores — tap a face to mark it done.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/app/family/${familyId}/tasks`}>
            <PencilIcon /> Manage
          </Link>
        </Button>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => v && setView(v as "today" | "week")}
        >
          <ToggleGroupItem value="today">Today</ToggleGroupItem>
          <ToggleGroupItem value="week">Week</ToggleGroupItem>
        </ToggleGroup>
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
                    subLabel={dayLabel(o.occurrence_date, today)}
                    onToggle={(mid) => toggle(o, mid)}
                    onSwap={(mid) => swapTo(o, mid)}
                    onSkip={(scope) => skip(o, scope)}
                    onReset={() => resetRotation(o)}
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
                    onToggle={(mid) => toggle(o, mid)}
                    onSwap={(mid) => swapTo(o, mid)}
                    onSkip={(scope) => skip(o, scope)}
                    onReset={() => resetRotation(o)}
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
  subLabel,
  onToggle,
  onSwap,
  onSkip,
  onReset,
}: {
  occurrence: TaskOccurrenceOut
  visibleMembers: MemberRow[]
  routineName?: string
  canManage: boolean
  allMembers: MemberRow[]
  subLabel?: string
  onToggle: (memberId: string) => void
  onSwap: (memberId: string) => void
  onSkip: (scope: "occurrence" | "turn") => void
  onReset: () => void
}) {
  const isRotating = o.up_next != null
  const showMenu = canManage && isRotating
  const multiDayTurn = o.rotation_unit !== "occurrence" || o.rotation_interval > 1
  const swapTargets = allMembers.filter((m) => !o.members.some((mm) => mm.id === m.id))

  return (
    <li className="bg-card ring-foreground/5 flex items-center gap-3 rounded-2xl p-3 shadow-sm ring-1">
      <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: o.effective_color }} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate font-medium leading-tight",
            o.is_skipped && "text-muted-foreground line-through",
          )}
        >
          {o.title}
        </p>
        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {subLabel && <span>{subLabel}</span>}
          {routineName && <span>{routineName}</span>}
          {o.star_value > 0 && (
            <span className="inline-flex items-center gap-0.5 text-amber-500">
              <StarIcon className="size-3 fill-amber-400 text-amber-400" />
              {o.star_value}
            </span>
          )}
        </div>
      </div>

      {/* Assignee avatars double as the done toggle. */}
      <div className="flex items-center gap-1.5">
        {o.is_skipped ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <BanIcon className="size-3.5" /> Skipped
          </span>
        ) : visibleMembers.length === 0 ? (
          <span className="text-muted-foreground text-xs">Unassigned</span>
        ) : (
          visibleMembers.map((m) => {
            const done = o.completed_member_ids.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onToggle(m.id)}
                aria-pressed={done}
                aria-label={`${done ? "Undo" : "Mark"} ${o.title} done for ${m.name}`}
                title={m.name}
                className={cn(
                  "relative flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white transition-all",
                  "focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2",
                  done ? "ring-2 ring-offset-1" : "opacity-90 hover:opacity-100",
                )}
                style={{ backgroundColor: m.color }}
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
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  )
}
