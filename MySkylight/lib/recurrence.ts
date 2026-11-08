import type { RotationUnit } from "@/lib/types/task"

// Task recurrence presets, mirroring the calendar's RRULE options but expressed
// for whole-date chores (no time-of-day). "none" is a sentinel for a one-off task
// — the Select can't bind an empty string value.

export const TASK_RRULE_OPTIONS = [
  { label: "One-time", value: "none" },
  { label: "Every day", value: "FREQ=DAILY" },
  { label: "Weekdays (Mon–Fri)", value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Every week", value: "FREQ=WEEKLY" },
  { label: "Every 2 weeks", value: "FREQ=WEEKLY;INTERVAL=2" },
  { label: "Every month", value: "FREQ=MONTHLY" },
] as const

// Weekdays in canonical Monday→Sunday order (matches RRULE BYDAY codes).
export const WEEKDAYS = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
] as const

export type WeekdayCode = (typeof WEEKDAYS)[number]["code"]

// Sentinel for the Repeat select's "Every N days/weeks/months…" mode. The form
// field holds the assembled FREQ=…;INTERVAL=N string; N=1 collapses to the plain
// "every day/week/month" preset.
export const CUSTOM_INTERVAL = "custom-interval"

export type IntervalUnit = "day" | "week" | "month"

const FREQ_FOR_UNIT: Record<IntervalUnit, string> = {
  day: "DAILY",
  week: "WEEKLY",
  month: "MONTHLY",
}

/**
 * Build an "every N {unit}s" rrule. N=1 collapses to the plain `FREQ=…` preset.
 * `days` pins weekday(s) and only applies to weekly cadences (any N).
 */
export function intervalRrule(n: number, unit: IntervalUnit, days: WeekdayCode[] = []): string {
  const interval = Math.max(1, Math.floor(n))
  const freq = FREQ_FOR_UNIT[unit]
  if (unit === "week" && days.length) {
    const byday = WEEKDAYS.map((d) => d.code).filter((c) => days.includes(c)).join(",")
    return interval === 1
      ? `FREQ=WEEKLY;BYDAY=${byday}`
      : `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${byday}`
  }
  return interval === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${interval}`
}

/**
 * Read a recurrence into `{ n, unit }`. Returns null for anything that isn't
 * daily/weekly/monthly. A BYDAY on a weekly rule is a pinned weekday and is ignored
 * here (read it with `parseByday`). UNTIL (an end date) is ignored.
 */
export function parseInterval(rrule: string | null): { n: number; unit: IntervalUnit } | null {
  if (!rrule) return null
  let unit: IntervalUnit | null = null
  if (rrule.includes("FREQ=DAILY")) unit = "day"
  else if (rrule.includes("FREQ=WEEKLY")) unit = "week"
  else if (rrule.includes("FREQ=MONTHLY")) unit = "month"
  if (!unit) return null
  const m = rrule.match(/INTERVAL=(\d+)/)
  const n = m ? Math.max(1, parseInt(m[1], 10)) : 1
  if (rrule.includes("BYDAY=") && unit !== "week") return null
  return { n, unit }
}

/** True for an explicit "every N units" (N ≥ 2) — distinct from the named presets. */
export function isCustomInterval(rrule: string | null): boolean {
  const p = parseInterval(rrule)
  return p !== null && p.n >= 2
}

/**
 * A recurring chore whose cadence re-phases off its anchor (`start_date`), so
 * "Move to today" can shift the whole future series. True for interval-style rules
 * (daily / every-N-days / plain weekly / monthly); false for one-offs and for
 * `BYDAY=`/`BYMONTHDAY=` rules that pin explicit calendar days (re-anchoring can't
 * move those). Mirrors the backend guard in `move_task_to_today`.
 */
export function canRephase(rrule: string | null): boolean {
  return !!rrule && !rrule.includes("BYDAY=") && !rrule.includes("BYMONTHDAY=")
}

// ── End date (RRULE UNTIL) ──────────────────────────────────────────────────
// The "pattern" (FREQ/INTERVAL/BYDAY) and the optional end date are edited as two
// separate controls; we keep UNTIL out of the form's rrule field and only splice
// it in when assembling the value to save. UNTIL is written as a bare YYYYMMDD
// date — the backend anchors recurrence at a naive `start_date` midnight, so a
// date-form UNTIL stays naive-compatible (a trailing 'Z' would make dateutil
// reject it against the naive DTSTART) and is inclusive of that day.

/** Strip any UNTIL/COUNT clause, returning the bare recurrence pattern. */
export function stripUntil(rrule: string): string {
  return rrule
    .split(";")
    .filter((p) => !/^UNTIL=/i.test(p) && !/^COUNT=/i.test(p))
    .join(";")
}

/** Drop BYDAY from a rule — the "Auto" form of a weekly chore the app placed on a day. */
export function stripByday(rrule: string): string {
  return rrule
    .split(";")
    .filter((p) => !/^BYDAY=/i.test(p))
    .join(";")
}

/** True for a weekly rule with chosen days — i.e. the user picked the day(s). */
export function isPinnedWeekly(rrule: string | null): boolean {
  return !!rrule && /FREQ=WEEKLY/i.test(rrule) && /BYDAY=/i.test(rrule)
}

/**
 * True when the app (not the user) chose this weekly chore's day: a weekly rule
 * with a concrete day that isn't pinned. Chores saved before auto-day existed
 * default to unpinned too, so they read as auto as well (the balancer may move them).
 */
export function isAutoPlaced(task: { rrule: string | null; day_pinned?: boolean }): boolean {
  return isPinnedWeekly(task.rrule) && task.day_pinned === false
}

/**
 * True when the app can pick this chore's starting day: every 2–28 days, or every
 * month. (Weekly chores get a weekday instead — see `isAutoPlaced`.) Mirrors the
 * backend's `_auto_kind == "phase"`.
 */
export function isPhaseAuto(rrule: string | null): boolean {
  const iv = parseInterval(rrule)
  if (!iv) return false
  if (iv.unit === "day") return iv.n >= 2 && iv.n <= 28
  return iv.unit === "month" && iv.n === 1 && !/BYMONTHDAY=|BYDAY=/.test(rrule ?? "")
}

/** "Tuesdays" for the single day of an auto-placed chore, or null if it has none/several. */
export function autoDayName(rrule: string | null): string | null {
  const days = parseByday(rrule)
  if (days.length !== 1) return null
  const d = WEEKDAYS.find((w) => w.code === days[0])
  return d ? `${d.label}s` : null
}

/** Pull the UNTIL date out of an rrule as YYYY-MM-DD, or null if open-ended. */
export function parseUntil(rrule: string | null): string | null {
  if (!rrule) return null
  const m = rrule.match(/UNTIL=(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** Append/replace UNTIL on a pattern from a YYYY-MM-DD date (null clears it). */
export function withUntil(rrule: string, untilYMD: string | null): string {
  const base = stripUntil(rrule)
  if (!untilYMD) return base
  return `${base};UNTIL=${untilYMD.replace(/-/g, "")}`
}

/** Pull the BYDAY day codes out of a weekly rrule, in canonical Mon→Sun order. */
export function parseByday(rrule: string | null): WeekdayCode[] {
  if (!rrule) return []
  const match = rrule.match(/BYDAY=([A-Z,]+)/)
  if (!match) return []
  const set = new Set(match[1].split(","))
  return WEEKDAYS.map((d) => d.code).filter((c) => set.has(c))
}

/** Build a weekly rrule from a set of weekday codes (re-ordered Mon→Sun). */
export function bydayRrule(days: WeekdayCode[]): string {
  const ordered = WEEKDAYS.map((d) => d.code).filter((c) => days.includes(c))
  return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`
}

/** The weekday code for a YYYY-MM-DD date — used to seed custom days. */
export function weekdayOf(ymd: string): WeekdayCode {
  const [y, m, d] = ymd.split("-").map(Number)
  // getDay(): 0=Sun … 6=Sat. Parsed as a local date to avoid TZ drift.
  const dow = new Date(y, m - 1, d).getDay()
  return (["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const)[dow]
}

/** Human-readable summary of a task's recurrence, for list rows. */
export function describeTaskRrule(
  rrule: string | null,
  task?: { day_pinned?: boolean },
): string {
  if (!rrule) return "One-time"
  const preset = TASK_RRULE_OPTIONS.find((o) => o.value === rrule)
  if (preset) return preset.label
  // Custom weekly day-set, e.g. FREQ=WEEKLY;BYDAY=TU,SA → "Tue, Sat".
  if (rrule.includes("FREQ=WEEKLY") && rrule.includes("BYDAY=")) {
    const days = parseByday(rrule)
    if (days.length) {
      const list = WEEKDAYS.filter((d) => days.includes(d.code))
        .map((d) => d.label)
        .join(", ")
      const auto = isAutoPlaced({ rrule, day_pinned: task?.day_pinned })
      const n = parseInterval(rrule)?.n ?? 1
      const label = n >= 2 ? `Every ${n} weeks on ${list}` : list
      return withEnd(auto ? `${label} (auto)` : label, rrule)
    }
  }
  const iv = parseInterval(rrule)
  if (iv) {
    const base =
      iv.n > 1
        ? `Every ${iv.n} ${iv.unit}s`
        : { day: "Daily", week: "Weekly", month: "Monthly" }[iv.unit]
    // Every-N-days / monthly: the app chose the starting day unless the user pinned a date.
    const auto = task?.day_pinned === false && isPhaseAuto(rrule)
    return withEnd(auto ? `${base} (auto)` : base, rrule)
  }
  if (rrule.includes("FREQ=YEARLY")) return withEnd("Yearly", rrule)
  return "Repeats"
}

/** Suffix a recurrence label with "· until <date>" when the rrule has an end. */
function withEnd(label: string, rrule: string): string {
  const until = parseUntil(rrule)
  if (!until) return label
  const [y, m, d] = until.split("-").map(Number)
  const when = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
  return `${label} · until ${when}`
}

// ── Schedule detail for task rows ───────────────────────────────────────────
// Pairs with describeTaskRrule (the recurrence chip): the chip says *how often*,
// this says *when* — the date a task starts (or is due, for one-offs) and the
// weekday / day-of-month a plain recurrence lands on, derived from start_date
// when the pattern itself carries no explicit day-set (BYDAY).

/** Format a YYYY-MM-DD as "Jun 15, 2026" (parsed local to avoid TZ drift). */
export function formatTaskDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

/** Full weekday name for a YYYY-MM-DD, e.g. "Monday". */
function weekdayName(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long" })
}

/** Ordinal day-of-month for a YYYY-MM-DD, e.g. "15th". */
function dayOfMonthOrdinal(ymd: string): string {
  const day = Number(ymd.split("-")[2])
  const suffixes = ["th", "st", "nd", "rd"]
  const v = day % 100
  const suffix = suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]
  return `${day}${suffix}`
}

/**
 * One-line plain-English schedule for a task row — the start (or due) date, plus
 * the weekday/day-of-month a plain recurrence lands on when the recurrence chip
 * doesn't already list specific days (BYDAY). For a one-off it's just the date.
 */
export function scheduleDetail(task: { start_date: string; rrule: string | null }): string {
  if (!task.rrule) return formatTaskDate(task.start_date)
  const parts: string[] = []
  // Name the day only when the pattern has no explicit day-set of its own.
  if (!task.rrule.includes("BYDAY=")) {
    const iv = parseInterval(task.rrule)
    if (iv?.unit === "week") parts.push(`on ${weekdayName(task.start_date)}s`)
    else if (iv?.unit === "month") parts.push(`on the ${dayOfMonthOrdinal(task.start_date)}`)
  }
  parts.push(`from ${formatTaskDate(task.start_date)}`)
  return parts.join(" · ")
}

// Coarse recurrence buckets for the chores "timeframe" filter. We only need the
// FREQ — interval/byday detail is irrelevant to "show me the weekly chores".
export type ChoreFrequency = "one-off" | "daily" | "weekly" | "monthly"

export const FREQUENCY_FILTER_OPTIONS: { value: ChoreFrequency; label: string }[] = [
  { value: "one-off", label: "One-time" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]

/** Bucket a task's rrule into a coarse frequency for filtering. */
export function classifyFrequency(rrule: string | null): ChoreFrequency {
  if (!rrule) return "one-off"
  if (rrule.includes("FREQ=DAILY")) return "daily"
  if (rrule.includes("FREQ=MONTHLY")) return "monthly"
  if (rrule.includes("FREQ=YEARLY")) return "monthly" // rare; group with monthly
  // Weekdays/weekly/every-N-weeks and any other weekly variants.
  return "weekly"
}

/** Short human label for a rotation cadence, e.g. "weekly" or "every 2 weeks". */
export function describeRotation(unit: RotationUnit, interval: number): string {
  if (unit === "occurrence") return interval === 1 ? "each time" : `every ${interval} times`
  if (interval === 1) return { day: "daily", week: "weekly", month: "monthly" }[unit]
  return `every ${interval} ${unit}s`
}
