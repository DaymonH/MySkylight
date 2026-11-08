"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"

import { DEFAULT_SLEEP, parseSleepSettings, type SleepSettings } from "@/lib/sleep"

const STORAGE_KEY = "skylight:settings:sleep"
const CHANGE_EVENT = "skylight:sleep-changed"
const DEFAULT_RAW = JSON.stringify(DEFAULT_SLEEP)

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
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_RAW
  } catch {
    return DEFAULT_RAW
  }
}

function getServerSnapshot(): string {
  return DEFAULT_RAW
}

/**
 * This display's sleep schedule. Device-local (localStorage), like the calendar hours:
 * each screen decides for itself when to go dark, and nothing needs the backend.
 * Pairing-based per-device settings (Phase 8) can replace the storage later.
 */
export function useSleepSettings() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const settings = useMemo(() => parseSleepSettings(raw), [raw])

  const update = useCallback((patch: Partial<SleepSettings>) => {
    const next = { ...parseSleepSettings(getSnapshot()), ...patch }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // storage blocked — the setting just won't persist
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return { settings, update }
}
