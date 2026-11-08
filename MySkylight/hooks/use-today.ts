"use client"

import { useEffect, useState } from "react"

function ymdNow() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Today's local date as `YYYY-MM-DD`, kept current for a screen that never reloads.
 *
 * The wall display runs for weeks, and freshness elsewhere is SSE-driven — nothing
 * happens at midnight on its own, so anything computed from "today" at render time
 * (the chore board's day, the calendar's anchor, the countdown window) would keep
 * showing yesterday until something unrelated re-rendered it. This re-checks every
 * 30s and whenever the tab becomes visible again (browsers throttle timers in the
 * background), but only changes state — and so only re-renders its caller — when the
 * date actually rolls over.
 */
export function useTodayYMD(): string {
  const [today, setToday] = useState(ymdNow)
  useEffect(() => {
    const update = () => setToday(ymdNow())
    const id = setInterval(update, 30_000)
    document.addEventListener("visibilitychange", update)
    return () => {
      clearInterval(id)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])
  return today
}
