"use client"

import { useEffect, useState } from "react"

import { useSleepSettings } from "@/hooks/use-sleep-settings"
import { useWakeLock } from "@/hooks/use-wake-lock"
import { isAsleep } from "@/lib/sleep"

/** How long after the last touch the screen may go dark once the sleep window starts. */
const IDLE_MS = 5 * 60 * 1000

// A dim clock that hops a few pixels every 10 minutes, so no pixel sits lit on the
// same spot all night (burn-in on OLED / old LCD panels).
const DRIFT = [
  [0, 0],
  [24, -16],
  [-20, 20],
  [32, 12],
  [-28, -12],
  [8, 28],
] as const

/** Keeps the wall display's screen on for as long as /device is open. */
export function KeepScreenOn() {
  useWakeLock(true)
  return null
}

/**
 * The night-time sleep screen for the wall display: solid black, with an optional very
 * dim clock, from the configured start to end time. Tap it to wake — it stays awake
 * until a few minutes after the last touch, then goes dark again while still in the
 * window. Disabled by default; configured in Settings.
 */
export function SleepOverlay() {
  const { settings } = useSleepSettings()
  const [now, setNow] = useState(() => Date.now())
  const [lastActivity, setLastActivity] = useState(() => Date.now())

  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, 15_000)
    const onActivity = (e: Event) => {
      // A touch on the sleep screen itself is handled by its own onClick (below), so
      // the tap that wakes it can't also land on whatever is underneath.
      if ((e.target as HTMLElement | null)?.closest?.("[data-sleep-overlay]")) return
      const t = Date.now()
      setLastActivity(t)
      setNow(t)
    }
    window.addEventListener("pointerdown", onActivity, { passive: true })
    window.addEventListener("keydown", onActivity)
    document.addEventListener("visibilitychange", tick)
    return () => {
      clearInterval(id)
      window.removeEventListener("pointerdown", onActivity)
      window.removeEventListener("keydown", onActivity)
      document.removeEventListener("visibilitychange", tick)
    }
  }, [])

  const date = new Date(now)
  if (!isAsleep(settings, date, lastActivity, IDLE_MS)) return null

  const [dx, dy] = DRIFT[Math.floor(date.getMinutes() / 10) % DRIFT.length]
  return (
    <button
      type="button"
      data-sleep-overlay
      aria-label="Screen is asleep. Tap to wake."
      onClick={() => {
        const t = Date.now()
        setLastActivity(t)
        setNow(t)
      }}
      className="fixed inset-0 z-[100] flex cursor-default items-center justify-center bg-black"
    >
      {settings.showClock && (
        <span
          className="font-heading text-[7rem] leading-none font-semibold tracking-tight text-white/20 tabular-nums"
          style={{ transform: `translate(${dx}px, ${dy}px)` }}
        >
          {date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
      )}
    </button>
  )
}
