"use client"

import { useCallback, useSyncExternalStore } from "react"

const STORAGE_KEY = "skylight:settings:visibleHours"
const CHANGE_EVENT = "skylight:visible-hours-changed"

const DEFAULT_START = 7
const DEFAULT_END = 23

function encode(start: number, end: number) {
  return `${start}-${end}`
}

const DEFAULT_ENCODED = encode(DEFAULT_START, DEFAULT_END)

function parse(v: string | null): { start: number; end: number } {
  if (!v) return { start: DEFAULT_START, end: DEFAULT_END }
  const [s, e] = v.split("-").map((n) => Number.parseInt(n, 10))
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e > 24 || s >= e) {
    return { start: DEFAULT_START, end: DEFAULT_END }
  }
  return { start: s, end: e }
}

// External-store glue for `useSyncExternalStore`. Module-level so the
// references stay stable across renders. `subscribe`/`getSnapshot` only run on
// the client; the server uses `getServerSnapshot` (avoids an SSR/CSR mismatch
// without a hydrate-in-effect setState).
function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange()
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onStorage)
  }
}

function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_ENCODED
}

function getServerSnapshot(): string {
  return DEFAULT_ENCODED
}

/**
 * Shared visible-hours preference for the day/week calendar grids.
 * Backed by `localStorage` and broadcast via a custom event so that
 * the settings dialog and any mounted CalendarView stay in sync.
 */
export function useVisibleHours() {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const { start, end } = parse(value)

  const setRange = useCallback((nextStart: number, nextEnd: number) => {
    const s = Math.max(0, Math.min(23, nextStart))
    const e = Math.max(s + 1, Math.min(24, nextEnd))
    const next = encode(s, e)
    localStorage.setItem(STORAGE_KEY, next)
    // Same-tab listeners only get the custom event ("storage" fires in *other*
    // tabs); this also drives our own re-read via `subscribe`.
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return { start, end, setRange }
}
