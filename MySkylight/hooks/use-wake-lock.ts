"use client"

import { useEffect } from "react"

/**
 * Ask the browser to keep the screen on while this is mounted. The wall display must
 * not let the OS blank it (or suspend the page and its live-update stream); the app's
 * own sleep overlay decides when the screen should look dark. The lock is released by
 * the browser whenever the tab is hidden, so it's re-requested on becoming visible.
 * Unsupported browsers (or a refusal) are silently ignored.
 */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return

    let lock: WakeLockSentinel | null = null
    let cancelled = false

    async function acquire() {
      try {
        const next = await navigator.wakeLock.request("screen")
        if (cancelled) {
          void next.release().catch(() => {})
          return
        }
        lock = next
      } catch {
        // Not allowed right now (battery saver, hidden tab) — try again on next show.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire()
    }

    void acquire()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      void lock?.release().catch(() => {})
    }
  }, [enabled])
}
