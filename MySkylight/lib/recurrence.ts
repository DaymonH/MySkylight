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

// Sentinel value for the Repeat select's "Custom days…" mode. Never stored as an
// rrule — the form field always holds the assembled FREQ=WEEKLY;BYDAY=… string.
export const CUSTOM_WEEKLY = "custom-weekly"

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

/** Build an "every N {unit}s" rrule. N=1 collapses to the plain `FREQ=…` preset. */
export function intervalRrule(n: number, unit: IntervalUnit): string {
  const interval = Math.max(1, Math.floor(n))
  const freq = FREQ_FOR_UNIT[unit]
  return interval === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${interval}`
}

/**
 * Read a plain interval rule into `{ n, unit }`. Returns null for weekly *day-set*
 * rules (BYDAY=…) — those are the separate "Custom days…" mode — and for anything
 * that isn't daily/weekly/monthly. UNTIL (an end date) is ignored.
 */
export function parseInterval(rrule: string | null): { n: number; unit: IntervalUnit } | null {
  if (!rrule || rrule.includes("BYDAY=")) return null
  let unit: IntervalUnit | null = null
  if (rrule.includes("FREQ=DAILY")) unit = "day"
  else if (rrule.includes("FREQ=WEEKLY")) unit = "week"
  else if (rrule.includes("FREQ=MONTHLY")) unit = "month"
  if (!unit) return null
  const m = rrule.match(/INTERVAL=(\d+)/)
  return { n: m ? Math.max(1, parseInt(m[1], 10)) : 1, unit }
}

/** True for an explicit "every N units" (N ≥ 2) — distinct from the named presets. */
export function isCustomInterval(rrule: string | null): boolean {
  const p = parseInterval(rrule)
  return p !== null && p.n >= 2
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
export function describeTaskRrule(rrule: string | null): string {
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
      return withEnd(list, rrule)
    }
  }
  const iv = parseInterval(rrule)
  if (iv) {
    const base =
      iv.n > 1
        ? `Every ${iv.n} ${iv.unit}s`
        : { day: "Daily", week: "Weekly", month: "Monthly" }[iv.unit]
    return withEnd(base, rrule)
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
