"use client"

import { useCallback, useState } from "react"

function keyFor(familyId: string, surface: string) {
  return `skylight:hidden-calendars:${surface}:${familyId}`
}

function read(storageKey: string): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x): x is string => typeof x === "string"))
      : new Set()
  } catch {
    return new Set()
  }
}

/**
 * Which calendar sources the user has hidden from the calendar view, persisted
 * per family **and** surface (the wall display and a phone can hide different
 * calendars). Default is the empty set — every calendar shows — so this only
 * ever subtracts from what's visible; nothing to migrate for existing users.
 */
export function useHiddenCalendars(
  familyId: string,
  surface: "device" | "app" = "app",
) {
  const storageKey = keyFor(familyId, surface)
  const [hidden, setHidden] = useState<Set<string>>(() => read(storageKey))

  const persist = useCallback(
    (next: Set<string>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]))
      } catch {
        // Storage unavailable — the filter still works for this session.
      }
    },
    [storageKey],
  )

  const toggle = useCallback(
    (key: string) => {
      setHidden((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        persist(next)
        return next
      })
    },
    [persist],
  )

  const showAll = useCallback(() => {
    setHidden(() => {
      const next = new Set<string>()
      persist(next)
      return next
    })
  }, [persist])

  const hideAll = useCallback(
    (keys: string[]) => {
      setHidden(() => {
        const next = new Set(keys)
        persist(next)
        return next
      })
    },
    [persist],
  )

  return { hidden, toggle, showAll, hideAll }
}
