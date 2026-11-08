import type { OccurrenceOut } from "@/lib/types/calendar"

export interface PositionedEvent {
  occ: OccurrenceOut
  startMin: number
  endMin: number
  /** column index within its overlapping cluster */
  col: number
  /** total columns in its overlapping cluster */
  cols: number
}

/**
 * Lay out a single day's timed events into columns so overlapping events sit
 * side-by-side (the standard day/week calendar algorithm), instead of stacking
 * on top of each other.
 */
export function packDayEvents(evts: OccurrenceOut[]): PositionedEvent[] {
  const items: PositionedEvent[] = evts
    .map((occ) => {
      const start = new Date(occ.start_dt)
      const end = new Date(occ.end_dt)
      const startMin = start.getHours() * 60 + start.getMinutes()
      // An event ending on a later calendar day (overnight / multi-day) should
      // run to the bottom of this day's grid, not wrap back to an earlier
      // minute-of-day (e.g. 10pm–1am must not collapse to a 30-min sliver).
      const startDay = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate()
      ).getTime()
      const endDay = new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate()
      ).getTime()
      let endMin =
        endDay > startDay ? 24 * 60 : end.getHours() * 60 + end.getMinutes()
      // Guarantee a visible minimum slot for zero/negative-length same-day events.
      if (!Number.isFinite(endMin) || endMin <= startMin) endMin = startMin + 30
      return { occ, startMin, endMin, col: 0, cols: 1 }
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)

  const result: PositionedEvent[] = []
  let cluster: PositionedEvent[] = []
  let clusterEnd = -1

  const flush = () => {
    if (cluster.length === 0) return
    const colEnds: number[] = [] // last endMin placed in each column
    for (const it of cluster) {
      let placed = false
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= it.startMin) {
          it.col = c
          colEnds[c] = it.endMin
          placed = true
          break
        }
      }
      if (!placed) {
        it.col = colEnds.length
        colEnds.push(it.endMin)
      }
    }
    for (const it of cluster) {
      it.cols = colEnds.length
      result.push(it)
    }
    cluster = []
    clusterEnd = -1
  }

  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  flush()

  return result
}

export function minutesNow(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Wall-clock `HH:MM` for a click inside a time column, snapped *down* to `snap`
 * minutes. `clientY - columnTop` is the pixel offset into the column; the column
 * starts at `startMin` and each hour is `hourHeight` px tall. Clamped so the result
 * is always a valid time inside the visible window.
 */
export function slotTimeFromOffset(
  offsetY: number,
  startMin: number,
  endMin: number,
  hourHeight: number,
  snap = 30,
): string {
  const raw = startMin + (offsetY / hourHeight) * 60
  const snapped = Math.floor(raw / snap) * snap
  const clamped = Math.max(startMin, Math.min(snapped, endMin - snap, 23 * 60 + 30))
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}
