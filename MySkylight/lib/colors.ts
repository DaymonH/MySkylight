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
