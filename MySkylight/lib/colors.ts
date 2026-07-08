// Cohesive member / calendar color palette.
// Hand-picked hex values that echo the app's warm coral/amber theme while staying
// distinct enough to tell family members apart at a glance on the wall display.
export const MEMBER_COLORS = [
  "#f0603f", // coral (brand)
  "#f59e0b", // amber
  "#e11d6b", // raspberry
  "#0d9488", // teal
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#16a34a", // green
  "#0ea5e9", // sky
] as const

// Default color for the auto-created "Family" calendar.
export const DEFAULT_CALENDAR_COLOR = MEMBER_COLORS[0]

// Wider preset palette for external-calendar tints (F18/F20/F25). Users pick a
// calendar's color from these — no free-form hex — so tints stay cohesive with
// the warm brand while being distinct enough to tell calendars apart at a glance.
// Two calendars may share a color (the picker flags it), so this is a menu of
// suggestions, not a uniqueness constraint.
export const CALENDAR_COLORS = [
  "#f0603f", // coral (brand)
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // gold
  "#84cc16", // lime
  "#16a34a", // green
  "#0d9488", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
  "#e11d6b", // raspberry
] as const

// Accent palette for chore *routines*. Member color already answers "whose chore
// is this?", so routines need their own color channel to answer "which routine?".
// Kept distinct from MEMBER_COLORS' leading entries so a routine dot doesn't read
// as a member's swatch, while staying inside the cohesive warm/cool spread.
export const ROUTINE_COLORS = [
  "#0d9488", // teal
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#e11d6b", // raspberry
  "#8b5cf6", // violet
  "#0ea5e9", // sky
  "#16a34a", // green
  "#f97316", // orange
] as const

// Warm gray for the ungrouped "Anytime" pseudo-routine — reads as "no routine"
// rather than competing with the real routines' saturated accents.
const ROUTINE_NEUTRAL = "#a8a29e" // stone-400

/**
 * Stable accent color for a routine. Routines carry no color in the data model, so
 * we hash the routine id into `ROUTINE_COLORS` — the same routine always lands on
 * the same accent across cards/columns without any per-routine config. `null`
 * (ungrouped "Anytime") gets a neutral gray.
 */
export function routineAccent(routineId: string | null): string {
  if (!routineId) return ROUTINE_NEUTRAL
  let h = 0
  for (let i = 0; i < routineId.length; i++) h = (Math.imul(h, 31) + routineId.charCodeAt(i)) | 0
  return ROUTINE_COLORS[Math.abs(h) % ROUTINE_COLORS.length]
}

// Warm near-black used for text/avatars placed on a light event color, so it
// sits with the cozy palette instead of a clinical pure black.
const ON_LIGHT = "#1c1917"
const ON_DARK = "#ffffff"

/**
 * Pick a readable text color (near-black or white) for text/initials placed on a
 * solid background `hex`. Light palette colors — amber (#f59e0b), sky (#0ea5e9) —
 * are unreadable under white, so we flip to dark text using WCAG relative
 * luminance. Falls back to white for any value we can't parse as #rrggbb.
 */
export function readableTextOn(hex: string): string {
  const c = hex?.replace("#", "")
  if (!c || c.length !== 6) return ON_DARK
  const r = parseInt(c.slice(0, 2), 16) / 255
  const g = parseInt(c.slice(2, 4), 16) / 255
  const b = parseInt(c.slice(4, 6), 16) / 255
  if ([r, g, b].some(Number.isNaN)) return ON_DARK
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  // 0.30 sits in the gap between the darker palette colors (coral/teal/green,
  // L≈0.23–0.27, which read fine under white — matching the brand's own
  // white-on-coral primary button) and the light ones (amber L≈0.44, sky
  // L≈0.33) where white text drops below 3:1 contrast and must flip to dark.
  return L > 0.3 ? ON_LIGHT : ON_DARK
}
