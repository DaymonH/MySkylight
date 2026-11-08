"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties, MouseEvent, PointerEvent } from "react"

import {
  DRAG_THRESHOLD_PX,
  applyMove,
  applyResize,
  changed,
  isDraggable,
  pxToMinutes,
  type Span,
} from "@/lib/event-drag"
import type { OccurrenceOut } from "@/lib/types/calendar"

interface Config {
  /** Pixels per hour in the grid. */
  hourHeight: number
  /** Visible window, in minutes of the day. */
  startMin: number
  endMin: number
  /** Width of one day column in px (week view); 0 keeps the drag vertical (day view). */
  columnWidth: number
  /** Allow dragging with a finger. Only on the wall display, whose grid doesn't scroll —
   *  on a phone a finger on an event must still scroll the grid. */
  touchEnabled: boolean
  /** Called once, on release, with the event's new time. Never for a no-op. */
  onCommit: (occ: OccurrenceOut, span: Span) => void
}

interface Press {
  occ: OccurrenceOut
  mode: "move" | "resize"
  x: number
  y: number
  moved: boolean
  original: Span
  latest: Span
}

export interface DragVisual {
  /** px to translate the event by (move) and px to add to its height (resize). */
  x: number
  y: number
  extraHeight: number
}

const keyOf = (o: OccurrenceOut) => `${o.event_id}:${o.occurrence_date}`

/**
 * Drag an event to move it (any column in the week view) or its bottom handle to
 * resize it, snapped to 15 minutes and kept inside the visible hours.
 *
 * A press only becomes a drag after DRAG_THRESHOLD_PX of travel, so a plain tap still
 * opens the editor; after a real drag the trailing click is swallowed. Esc cancels.
 * The grids render the live offset from `visual()`; the change is committed once, on
 * release (the caller decides whether to ask which occurrences it applies to).
 */
export function useEventDrag(config: Config) {
  const cfg = useRef(config)
  useEffect(() => {
    cfg.current = config
  })

  const press = useRef<Press | null>(null)
  const swallowClick = useRef(false)
  const cleanup = useRef<(() => void) | null>(null)
  const [active, setActive] = useState<{ key: string; visual: DragVisual } | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  const begin = useCallback((e: PointerEvent, occ: OccurrenceOut, mode: "move" | "resize") => {
    const c = cfg.current
    if (e.button !== 0 || !isDraggable(occ)) return
    if (e.pointerType === "touch" && !c.touchEnabled) return
    const original = { start: new Date(occ.start_dt), end: new Date(occ.end_dt) }
    press.current = { occ, mode, x: e.clientX, y: e.clientY, moved: false, original, latest: original }
    if (mode === "resize") e.stopPropagation() // the handle sits inside the event's own button

    const bounds = () => ({ lo: cfg.current.startMin, hi: cfg.current.endMin })

    const onMove = (ev: globalThis.PointerEvent) => {
      const p = press.current
      if (!p) return
      const dx = ev.clientX - p.x
      const dy = ev.clientY - p.y
      if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      p.moved = true
      const { hourHeight, columnWidth } = cfg.current
      const deltaMin = pxToMinutes(dy, hourHeight)
      const dayDelta = p.mode === "move" && columnWidth > 0 ? Math.round(dx / columnWidth) : 0
      p.latest =
        p.mode === "move"
          ? applyMove(p.original, deltaMin, dayDelta, bounds())
          : applyResize(p.original, deltaMin, bounds())
      const minOf = (d: Date) => d.getHours() * 60 + d.getMinutes()
      const px = (mins: number) => (mins / 60) * hourHeight
      setActive({
        key: keyOf(p.occ),
        visual:
          p.mode === "move"
            ? {
                x: dayDelta * columnWidth,
                y: px(minOf(p.latest.start) - minOf(p.original.start)),
                extraHeight: 0,
              }
            : { x: 0, y: 0, extraHeight: px(minOf(p.latest.end) - minOf(p.original.end)) },
      })
    }

    const finish = (commit: boolean) => {
      const p = press.current
      press.current = null
      cleanup.current?.()
      cleanup.current = null
      setActive(null)
      if (!p?.moved) return
      // The browser fires a click right after the release; it must not open the editor.
      swallowClick.current = true
      setTimeout(() => (swallowClick.current = false), 0)
      if (commit && changed(p.original, p.latest)) cfg.current.onCommit(p.occ, p.latest)
    }

    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(false)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    window.addEventListener("keydown", onKey)
    cleanup.current = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  /** Props for an event's button (start a move; swallow the click after a drag). */
  const eventProps = useCallback(
    (occ: OccurrenceOut) => ({
      onPointerDown: (e: PointerEvent) => begin(e, occ, "move"),
      onClickCapture: (e: MouseEvent) => {
        if (swallowClick.current) {
          e.stopPropagation()
          e.preventDefault()
        }
      },
    }),
    [begin],
  )

  /** Props for the resize handle inside an event. */
  const handleProps = useCallback(
    (occ: OccurrenceOut) => ({
      onPointerDown: (e: PointerEvent) => begin(e, occ, "resize"),
    }),
    [begin],
  )

  /** Inline style to merge onto an event while it is (or can be) dragged. */
  const style = useCallback(
    (occ: OccurrenceOut, baseHeight: number): CSSProperties => {
      const touchAction = cfg.current.touchEnabled && isDraggable(occ) ? "none" : undefined
      if (!active || active.key !== keyOf(occ)) return touchAction ? { touchAction } : {}
      const v = active.visual
      return {
        touchAction,
        transform: `translate(${v.x}px, ${v.y}px)`,
        height: baseHeight + v.extraHeight,
        zIndex: 40,
        boxShadow: "0 8px 24px rgb(0 0 0 / 0.25)",
        transition: "none",
        cursor: "grabbing",
      }
    },
    [active],
  )

  return {
    eventProps,
    handleProps,
    style,
    draggingKey: active?.key ?? null,
    canDrag: isDraggable,
  }
}
