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
