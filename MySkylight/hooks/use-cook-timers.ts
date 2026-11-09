"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export interface CookTimer {
  id: number
  label: string
  /** Epoch ms the countdown ends. */
  endsAt: number
  totalSeconds: number
  done: boolean
}

/** Three short beeps. Needs an AudioContext that was created after a tap (autoplay rules). */
function beep(ctx: AudioContext | null) {
  if (!ctx) return
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = 880
    gain.gain.value = 0.25
    osc.connect(gain).connect(ctx.destination)
    const t = ctx.currentTime + i * 0.3
    osc.start(t)
    osc.stop(t + 0.18)
  }
}

/**
 * Kitchen timers for the cook view. Several can run at once; each one that finishes beeps
 * every few seconds (and the UI flashes) until it's dismissed. Starting a timer is a tap,
 * which is also what unlocks audio in the kiosk browser.
 */
export function useCookTimers() {
  const [timers, setTimers] = useState<CookTimer[]>([])
  const [now, setNow] = useState(() => Date.now())
  const nextId = useRef(1)
  const audio = useRef<AudioContext | null>(null)

  // One shared clock while anything is running or ringing.
  useEffect(() => {
    if (timers.length === 0) return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      setTimers((ts) => {
        let changed = false
        const next = ts.map((x) => {
          if (!x.done && n >= x.endsAt) {
            changed = true
            return { ...x, done: true }
          }
          return x
        })
        return changed ? next : ts
      })
    }, 500)
    return () => clearInterval(t)
  }, [timers.length])

  const ringing = timers.some((t) => t.done)
  useEffect(() => {
    if (!ringing) return
    beep(audio.current)
    const t = setInterval(() => beep(audio.current), 3000)
    return () => clearInterval(t)
  }, [ringing])

  const start = useCallback((label: string, seconds: number) => {
    try {
      audio.current ??= new AudioContext()
      void audio.current.resume()
    } catch {
      // No Web Audio: the timer still counts down and flashes, just silently.
    }
    const n = Date.now()
    setNow(n)
    setTimers((ts) => [
      ...ts,
      { id: nextId.current++, label, endsAt: n + seconds * 1000, totalSeconds: seconds, done: false },
    ])
  }, [])

  const dismiss = useCallback((id: number) => {
    setTimers((ts) => ts.filter((t) => t.id !== id))
  }, [])

  return { timers, now, start, dismiss, ringing }
}
