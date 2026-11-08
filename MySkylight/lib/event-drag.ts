/** Drag-to-move / drag-to-resize maths for timed events in the day and week grids.
 *  Pure functions (no DOM), so the rules are testable on their own. */

/** Events snap to this many minutes while dragging. */
export const SNAP_MINUTES = 15

/** The shortest an event can be resized to. */
export const MIN_DURATION_MINUTES = 15

/** Pixels the pointer must travel before a press becomes a drag (so taps still open the editor). */
export const DRAG_THRESHOLD_PX = 6

/** Round to the nearest `snap` minutes (ties round up, away from zero for negatives too). */
export function snapMinutes(minutes: number, snap = SNAP_MINUTES): number {
  return Math.round(minutes / snap) * snap
}

/** Minutes a vertical pointer offset represents in a grid with `hourHeight` px per hour. */
export function pxToMinutes(px: number, hourHeight: number): number {
  return (px / hourHeight) * 60
}

const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()
const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** Whether a drag/resize is offered for this event: timed, not all-day, within one day. */
export function isDraggable(o: { all_day: boolean; read_only: boolean; start_dt: string; end_dt: string }): boolean {
  if (o.all_day || o.read_only) return false
  return sameLocalDay(new Date(o.start_dt), new Date(o.end_dt))
}

export interface Span {
  start: Date
  end: Date
}

/**
 * Move an event by `deltaMinutes` (snapped) and `dayDelta` whole days, keeping its
 * length, and keeping it inside the visible window `[lo, hi]` (minutes of day) so it
 * can't be dragged off the top or bottom of the grid. Days move by calendar date, not
 * by 24h, so a DST change can't shift the wall-clock time.
 */
export function applyMove(
  original: Span,
  deltaMinutes: number,
  dayDelta: number,
  bounds: { lo: number; hi: number },
): Span {
  const duration = original.end.getTime() - original.start.getTime()
  const durationMin = Math.round(duration / 60000)
  const startMin = minuteOfDay(original.start)
  let target = startMin + snapMinutes(deltaMinutes)
  target = Math.min(target, bounds.hi - durationMin) // not past the bottom...
  target = Math.max(target, bounds.lo) // ...or above the top
  const start = new Date(original.start)
  start.setDate(start.getDate() + dayDelta)
  start.setHours(Math.floor(target / 60), target % 60, 0, 0)
  return { start, end: new Date(start.getTime() + duration) }
}

/** Resize by moving the end edge `deltaMinutes` (snapped); the start never moves. */
export function applyResize(
  original: Span,
  deltaMinutes: number,
  bounds: { lo: number; hi: number },
): Span {
  const startMin = minuteOfDay(original.start)
  const endMin = minuteOfDay(original.end)
  let target = endMin + snapMinutes(deltaMinutes)
  target = Math.min(target, bounds.hi)
  target = Math.max(target, startMin + MIN_DURATION_MINUTES)
  const end = new Date(original.start)
  end.setHours(Math.floor(target / 60), target % 60, 0, 0)
  return { start: new Date(original.start), end }
}

/** Did the dragged span actually change? (A drag back to where it started is a no-op.) */
export function changed(a: Span, b: Span): boolean {
  return a.start.getTime() !== b.start.getTime() || a.end.getTime() !== b.end.getTime()
}
