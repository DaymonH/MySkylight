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

/** Human-readable summary of a task's recurrence, for list rows. */
export function describeTaskRrule(rrule: string | null): string {
  if (!rrule) return "One-time"
  const preset = TASK_RRULE_OPTIONS.find((o) => o.value === rrule)
  if (preset) return preset.label
  if (rrule.includes("FREQ=DAILY")) return "Daily"
  if (rrule.includes("FREQ=WEEKLY")) return "Weekly"
  if (rrule.includes("FREQ=MONTHLY")) return "Monthly"
  if (rrule.includes("FREQ=YEARLY")) return "Yearly"
  return "Repeats"
}
