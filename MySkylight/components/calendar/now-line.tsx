"use client"

import { useEffect, useState } from "react"

import { minutesNow } from "./event-layout"

/**
 * The red "now" line. Owns its own per-minute tick so only this element
 * re-renders each minute, not the whole week/day grid around it.
 */
export function NowLine({
  startMin,
  endMin,
  hourHeight,
}: {
  startMin: number
  endMin: number
  hourHeight: number
}) {
  const [now, setNow] = useState(minutesNow)
  useEffect(() => {
    const id = setInterval(() => setNow(minutesNow()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (now < startMin || now > endMin) return null
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-30"
      style={{ top: ((now - startMin) / 60) * hourHeight }}
    >
      <div className="bg-now relative h-px">
        <span className="bg-now absolute -top-1 -left-1 size-2 rounded-full" />
      </div>
    </div>
  )
}
