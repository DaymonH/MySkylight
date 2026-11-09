// Finds cooking times written in a recipe step ("bake 25 minutes", "simmer 1 1/2 hours",
// "10-12 min") so the kiosk can offer a one-tap countdown for each.

export interface StepTimer {
  /** The matched text in the step, e.g. "25 minutes". */
  text: string
  seconds: number
  index: number
}

const NUM = String.raw`(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)`
const UNIT = String.raw`(hours?|hrs?|h|minutes?|mins?|min|seconds?|secs?)`
// "10-12 minutes", "10 to 12 minutes", "25 minutes", "1 1/2 hours"
const PATTERN = new RegExp(
  String.raw`\b${NUM}(?:\s*(?:-|–|—|to)\s*${NUM})?\s*${UNIT}\b`,
  "gi",
)

function toNumber(s: string): number {
  const parts = s.trim().split(/\s+/)
  return parts.reduce((sum, p) => {
    if (p.includes("/")) {
      const [a, b] = p.split("/").map(Number)
      return sum + (b ? a / b : 0)
    }
    return sum + Number(p)
  }, 0)
}

function unitSeconds(unit: string): number {
  const u = unit.toLowerCase()
  if (u.startsWith("h")) return 3600
  if (u.startsWith("m")) return 60
  return 1
}

/** All timers in a step, in order. A range ("10-12 minutes") uses the longer time. */
export function findTimers(step: string): StepTimer[] {
  const out: StepTimer[] = []
  for (const m of step.matchAll(PATTERN)) {
    const high = toNumber(m[2] ?? m[1])
    const seconds = Math.round(high * unitSeconds(m[3]))
    if (seconds <= 0 || seconds > 24 * 3600) continue
    const index = m.index ?? 0
    const prev = out[out.length - 1]
    // "1 hour 30 minutes" / "1 hour and 30 minutes" is one timer, not two.
    if (prev && /^\s*(?:,|and)?\s*$/i.test(step.slice(prev.index + prev.text.length, index))) {
      prev.seconds += seconds
      prev.text = step.slice(prev.index, index + m[0].length)
    } else {
      out.push({ text: m[0], seconds, index })
    }
  }
  return out
}

/** "25:00", "1:30:00" — a countdown clock. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`
}
