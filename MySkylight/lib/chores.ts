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

/** A week's date span for a header, e.g. "Jun 28 – Jul 4". */
export function weekRangeLabel(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  return `${parseYMD(start).toLocaleDateString(undefined, opts)} – ${parseYMD(end).toLocaleDateString(
    undefined,
    opts,
  )}`
}

/** Relative name for a Sunday-aligned week `offset` weeks from the current one. */
export function relativeWeekLabel(offset: number): string {
  if (offset === 0) return "This week"
  if (offset === 1) return "Next week"
  if (offset === -1) return "Last week"
  return offset > 0 ? `In ${offset} weeks` : `${-offset} weeks ago`
}

/**
 * Compact label for a *summed* minutes total (F30 aggregate), e.g. 45 → "45m",
 * 90 → "1h 30m", 120 → "2h". Unlike `bucketLabel` (which names a single chore's
 * time *range*), this is a point value for a per-person daily load. Returns "" for
 * a zero/negative total so callers can skip rendering it.
 */
export function formatMinutesTotal(mins: number): string {
  if (mins <= 0) return ""
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
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

/** Overdue = a past, un-skipped, un-dismissed occurrence that still has someone on
 *  the hook. (Dismissed = swept away by "Clear missed", which awards no stars.) */
export function isOverdue(o: TaskOccurrenceOut, asOf: string): boolean {
  return (
    o.occurrence_date < asOf &&
    !o.is_skipped &&
    !o.is_dismissed &&
    pendingMembers(o).length > 0
  )
}

/**
 * How long a missed chore stays on the Missed list, by how often it repeats. A daily
 * chore missed nine days ago isn't actionable — nobody can still "do Tuesday's
 * dishes" — so it quietly drops off instead of piling up; a weekly chore stays for
 * the week it belonged to; monthly and one-off chores hang around longest.
 * Anything older is simply not listed (it's still swept by "Clear missed").
 */
const MISSED_EXPIRY_DAYS: Record<ChoreFrequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  "one-off": 30,
}

/** Furthest back the Missed query needs to reach (the longest expiry above). */
export const MISSED_LOOKBACK_DAYS = 30

/** Whether a missed occurrence is still recent enough, for its frequency, to list.
 *  `asOf` is the same anchor `isOverdue` uses (today, or the viewed week's start). */
export function withinMissedWindow(
  o: TaskOccurrenceOut,
  asOf: string,
  frequency: ChoreFrequency,
): boolean {
  return o.occurrence_date >= addDaysYMD(asOf, -MISSED_EXPIRY_DAYS[frequency])
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
