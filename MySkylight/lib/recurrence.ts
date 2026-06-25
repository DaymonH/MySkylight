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
      return WEEKDAYS.filter((d) => days.includes(d.code))
        .map((d) => d.label)
        .join(", ")
    }
  }
  if (rrule.includes("FREQ=DAILY")) return "Daily"
  if (rrule.includes("FREQ=WEEKLY")) return "Weekly"
  if (rrule.includes("FREQ=MONTHLY")) return "Monthly"
  if (rrule.includes("FREQ=YEARLY")) return "Yearly"
  return "Repeats"
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
