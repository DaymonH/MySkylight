import type { MemberBrief } from "@/lib/types/calendar"
import type { TaskOccurrenceOut } from "@/lib/types/task"
import type { ChoreFrequency } from "@/lib/recurrence"

// ── Whole-date helpers (TZ-safe) ──────────────────────────────────────────────
//
// Chores recur on whole dates with no time-of-day, so we work in `YYYY-MM-DD`
// strings throughout and only touch `Date` for arithmetic/formatting. Parsing a
// YMD as a *local* date (not `new Date("2026-06-25")`, which is UTC midnight)
// avoids the off-by-one drift that bites timezones west of UTC — same approach as
// `weekdayOf` in lib/recurrence.ts. ISO date strings also compare lexically, so we
// can sort/range them as plain strings.

function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`
}

export function todayYMD(): string {
  return toYMD(new Date())
}

export function addDaysYMD(ymd: string, days: number): string {
  const d = parseYMD(ymd)
  d.setDate(d.getDate() + days)
  return toYMD(d)
}

/** Sunday-aligned week containing `ymd` — matches the calendar's week start. */
export function weekRangeYMD(ymd: string): { start: string; end: string } {
  const d = parseYMD(ymd)
  const start = new Date(d)
  start.setDate(d.getDate() - d.getDay()) // getDay(): 0=Sun → Sunday start
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return { start: toYMD(start), end: toYMD(end) }
}

/** The seven YMD dates of the Sunday-aligned week containing `ymd`. */
export function weekDatesYMD(ymd: string): string[] {
  const { start } = weekRangeYMD(ymd)
  return Array.from({ length: 7 }, (_, i) => addDaysYMD(start, i))
}

/** "Today" / "Yesterday" / "Tomorrow", else e.g. "Wed, Jun 25". */
export function dayLabel(ymd: string, today: string = todayYMD()): string {
  if (ymd === today) return "Today"
  if (ymd === addDaysYMD(today, -1)) return "Yesterday"
  if (ymd === addDaysYMD(today, 1)) return "Tomorrow"
  return parseYMD(ymd).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

/** Compact pieces for a week day-strip cell, e.g. { dow: "Wed", day: 25 }. */
export function dayStripLabel(ymd: string): { dow: string; day: number } {
  const d = parseYMD(ymd)
  return { dow: d.toLocaleDateString(undefined, { weekday: "short" }), day: d.getDate() }
}

// ── Per-occurrence completion semantics ───────────────────────────────────────

/** Assigned members who still owe this occurrence (not yet completed). */
export function pendingMembers(o: TaskOccurrenceOut): MemberBrief[] {
  return o.members.filter((m) => !o.completed_member_ids.includes(m.id))
}

/** An occurrence is "done" once every assigned member has checked it off. An
 *  occurrence with no assignees is never "done" (there's no one to complete it). */
export function occurrenceDone(o: TaskOccurrenceOut): boolean {
  return o.members.length > 0 && pendingMembers(o).length === 0
}

/** Overdue = a past, un-skipped occurrence that still has someone on the hook. */
export function isOverdue(o: TaskOccurrenceOut, asOf: string): boolean {
  return o.occurrence_date < asOf && !o.is_skipped && pendingMembers(o).length > 0
}

// ── Filters ───────────────────────────────────────────────────────────────────

export type CompletionStatus = "all" | "todo" | "done"

export interface ChoreFilters {
  status: CompletionStatus
  // `null` means "no filter on this axis" (show all). An empty array means the
  // user explicitly deselected everything → nothing matches.
  memberIds: string[] | null
  routineIds: (string | null)[] | null // a `null` entry == ungrouped ("Anytime")
  frequencies: ChoreFrequency[] | null
}

export const DEFAULT_FILTERS: ChoreFilters = {
  status: "all",
  memberIds: null,
  routineIds: null,
  frequencies: null,
}

export function filtersActive(f: ChoreFilters): boolean {
  return (
    f.status !== "all" ||
    f.memberIds !== null ||
    f.routineIds !== null ||
    f.frequencies !== null
  )
}

/** Does `o` pass the completion-status filter from a whole-occurrence view? */
export function matchesStatus(o: TaskOccurrenceOut, status: CompletionStatus): boolean {
  if (status === "all") return true
  if (status === "done") return occurrenceDone(o)
  return !occurrenceDone(o) // "todo"
}

/** Status filter from a single member's perspective (the device per-member cards). */
export function matchesStatusForMember(
  o: TaskOccurrenceOut,
  memberId: string,
  status: CompletionStatus,
): boolean {
  if (status === "all") return true
  const done = o.completed_member_ids.includes(memberId)
  return status === "done" ? done : !done
}

/**
 * Apply the member / routine / frequency filters (NOT completion status — that's
 * applied per-surface so the device cards can read it per-member). `freqByTaskId`
 * maps a task id to its frequency, derived from the task's rrule by the caller.
 */
export function applyFilters(
  items: TaskOccurrenceOut[],
  filters: ChoreFilters,
  freqByTaskId: Map<string, ChoreFrequency>,
): TaskOccurrenceOut[] {
  return items.filter((o) => {
    if (filters.memberIds !== null) {
      if (!o.members.some((m) => filters.memberIds!.includes(m.id))) return false
    }
    if (filters.routineIds !== null) {
      if (!filters.routineIds.includes(o.routine_id)) return false
    }
    if (filters.frequencies !== null) {
      const freq = freqByTaskId.get(o.task_id) ?? "one-off"
      if (!filters.frequencies.includes(freq)) return false
    }
    return true
  })
}
