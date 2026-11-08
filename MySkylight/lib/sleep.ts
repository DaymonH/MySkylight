/** Parse "HH:MM" into minutes after midnight, or null if it isn't a valid time. */
export function parseHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * Whether `nowMin` (minutes after midnight) falls inside the sleep window
 * `[fromMin, toMin)`. The window may wrap past midnight (21:30 → 06:30). Equal start
 * and end mean "no window" rather than "always asleep", so a half-edited setting can
 * never lock the screen dark.
 */
export function isWithinSleepWindow(nowMin: number, fromMin: number, toMin: number): boolean {
  if (fromMin === toMin) return false
  if (fromMin < toMin) return nowMin >= fromMin && nowMin < toMin
  return nowMin >= fromMin || nowMin < toMin
}

export interface SleepSettings {
  enabled: boolean
  /** "HH:MM" the screen goes to sleep. */
  from: string
  /** "HH:MM" it wakes again. */
  to: string
  /** Show a dim clock on the sleeping screen. */
  showClock: boolean
}

export const DEFAULT_SLEEP: SleepSettings = {
  enabled: false,
  from: "21:30",
  to: "06:30",
  showClock: true,
}

/** Decode the stored JSON, falling back to defaults field-by-field on anything odd. */
export function parseSleepSettings(raw: string | null): SleepSettings {
  if (!raw) return DEFAULT_SLEEP
  try {
    const v = JSON.parse(raw) as Partial<SleepSettings>
    return {
      enabled: v.enabled === true,
      from: typeof v.from === "string" && parseHHMM(v.from) !== null ? v.from : DEFAULT_SLEEP.from,
      to: typeof v.to === "string" && parseHHMM(v.to) !== null ? v.to : DEFAULT_SLEEP.to,
      showClock: v.showClock !== false,
    }
  } catch {
    return DEFAULT_SLEEP
  }
}

/**
 * Should the screen be dark right now? Asleep only when sleep is enabled, the time is
 * inside the window, and nobody has touched the screen for `idleMs` — so tapping the
 * dark screen wakes it, and using it just before bedtime isn't cut off mid-tap.
 */
export function isAsleep(
  settings: SleepSettings,
  now: Date,
  lastActivityMs: number,
  idleMs: number,
): boolean {
  if (!settings.enabled) return false
  const from = parseHHMM(settings.from)
  const to = parseHHMM(settings.to)
  if (from === null || to === null) return false
  const nowMin = now.getHours() * 60 + now.getMinutes()
  if (!isWithinSleepWindow(nowMin, from, to)) return false
  return now.getTime() - lastActivityMs >= idleMs
}
