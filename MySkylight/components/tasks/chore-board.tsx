"use client"

import { useMemo } from "react"
import type { CSSProperties } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckIcon, ListChecksIcon, Loader2Icon, PartyPopperIcon, RepeatIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import {
  useCompleteTask,
  useRoutines,
  useTaskOccurrences,
  useUncompleteTask,
} from "@/hooks/use-tasks"
import { cn } from "@/lib/utils"
import type { TaskOccurrenceOut } from "@/lib/types/task"

interface MemberRow {
  id: string
  name: string
  color: string
}

const ANYTIME_KEY = "__anytime__"

function todayYMD() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`
}

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
 * The device "chores" surface: one card per family member showing today's
 * assigned tasks with big, satisfying tap targets. Tapping toggles completion
 * for that member on today's occurrence (optimistic — the wall display reacts
 * instantly and any other screen catches up over SSE).
 */
export function ChoreBoard({ familyId }: { familyId: string }) {
  useRealtime(familyId)

  const api = useApi()
  const today = todayYMD()

  const { data: members = [] } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberRow[]>(`/families/${familyId}/members`),
    enabled: !!familyId,
  })
  const { data: routines = [] } = useRoutines(familyId)
  const { data: occurrences = [], isLoading } = useTaskOccurrences(familyId, today, today)

  const complete = useCompleteTask(familyId)
  const uncomplete = useUncompleteTask(familyId)

  // routine_id → sort_order, so member cards group chores in the same order the
  // routines were arranged (Morning before Bedtime, etc.). "Anytime" sorts last.
  const routineOrder = useMemo(() => {
    const m = new Map<string, { name: string; sort: number }>()
    routines.forEach((r) => m.set(r.id, { name: r.name, sort: r.sort_order }))
    return m
  }, [routines])

  function groupsFor(items: TaskOccurrenceOut[]): RoutineGroup[] {
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

  // Cards: one per member who has ≥1 chore today.
  const memberCards = members
    .map((m) => ({
      member: m,
      items: occurrences.filter((o) => o.members.some((mm) => mm.id === m.id)),
    }))
    .filter((c) => c.items.length > 0)

  // Tasks with no assignee can't be checked off per-member — surface them so they
  // don't silently vanish, with a hint to assign them.
  const unassigned = occurrences.filter((o) => o.members.length === 0)

  function toggle(o: TaskOccurrenceOut, memberId: string, done: boolean) {
    const vars = { taskId: o.task_id, memberId, occurrenceDate: today }
    if (done) uncomplete.mutate(vars)
    else complete.mutate(vars)
  }

  const heading = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-5 py-3.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <ListChecksIcon className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Chores</h1>
          <p className="text-muted-foreground text-sm">{heading}</p>
        </div>
      </div>

      <div className="thin-scrollbar flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
            <Loader2Icon className="size-5 animate-spin" />
            Loading chores…
          </div>
        ) : memberCards.length === 0 && unassigned.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-2xl">
              <PartyPopperIcon className="size-8" />
            </span>
            <div>
              <p className="font-heading text-xl font-semibold">No chores today</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Add chores from the companion app to see them here.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {memberCards.map(({ member, items }) => {
              const groups = groupsFor(items)
              const doneCount = items.filter((o) =>
                o.completed_member_ids.includes(member.id),
              ).length
              const allDone = doneCount === items.length

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
                        {doneCount} / {items.length} done
                      </p>
                    </div>
                    {allDone && (
                      <span className="text-2xl" role="img" aria-label="All done">
                        🎉
                      </span>
                    )}
                  </header>

                  <div className="flex flex-col gap-3">
                    {groups.map((g) => (
                      <div key={g.key} className="flex flex-col gap-1.5">
                        {groups.length > 1 && (
                          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                            {g.name}
                          </p>
                        )}
                        <ul className="flex flex-col gap-2">
                          {g.items.map((o) => {
                            const done = o.completed_member_ids.includes(member.id)
                            return (
                              <li key={o.task_id}>
                                <ChoreRow
                                  title={o.title}
                                  color={o.effective_color}
                                  done={done}
                                  upNext={o.up_next?.name}
                                  onToggle={() => toggle(o, member.id, done)}
                                />
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}

            {unassigned.length > 0 && (
              <section className="border-muted-foreground/20 flex flex-col gap-3 rounded-3xl border border-dashed p-5">
                <header>
                  <p className="text-lg font-semibold leading-tight">Unassigned</p>
                  <p className="text-muted-foreground text-sm">Assign these to a member to check off.</p>
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
          </div>
        )}
      </div>
    </div>
  )
}

function ChoreRow({
  title,
  color,
  done,
  upNext,
  onToggle,
}: {
  title: string
  color: string
  done: boolean
  upNext?: string
  onToggle: () => void
}) {
  const style: CSSProperties = done
    ? { backgroundColor: color, borderColor: color }
    : { borderColor: color }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={done}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors",
        "focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-2",
        done ? "bg-muted/50" : "hover:bg-muted/40",
      )}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl border-2 transition-all"
        style={style}
      >
        {done && (
          <CheckIcon className="size-5 text-white duration-200 animate-in zoom-in-50" />
        )}
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
        {upNext && !done && (
          <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
            <RepeatIcon className="size-3" /> Next: {upNext}
          </span>
        )}
      </span>
    </button>
  )
}
