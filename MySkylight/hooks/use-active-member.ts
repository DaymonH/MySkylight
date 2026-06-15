"use client"

import { useCallback, useSyncExternalStore } from "react"

const CHANGE_EVENT = "skylight:active-member-changed"

function keyFor(familyId: string, surface: string) {
  return `skylight:active-member:${surface}:${familyId}`
}

// Module-level so the reference stays stable across renders (re-subscribing only
// when it actually changes). Fires on our own custom event and on cross-tab
// `storage` events; the bound `getSnapshot` re-reads the right per-family key.
function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/**
 * The selected member "profile" filter for a family's calendar — the value behind
 * the avatar switcher on `/device` and `/app`. `null` means "Everyone".
 *
 * Persisted in `localStorage`, scoped per family **and** surface (so the wall
 * display and a phone can focus on different people), and broadcast via a custom
 * event so any view mounted in the same tab stays in sync.
 */
export function useActiveMember(familyId: string, surface: "device" | "app" = "app") {
  const storageKey = keyFor(familyId, surface)

  const getSnapshot = useCallback(
    () => (typeof window === "undefined" ? null : localStorage.getItem(storageKey)),
    [storageKey],
  )

  const activeMemberId = useSyncExternalStore(subscribe, getSnapshot, () => null)

  const setActiveMember = useCallback(
    (memberId: string | null) => {
      if (memberId) localStorage.setItem(storageKey, memberId)
      else localStorage.removeItem(storageKey)
      // "storage" only fires in *other* tabs; this drives our own re-read too.
      window.dispatchEvent(new Event(CHANGE_EVENT))
    },
    [storageKey],
  )

  return { activeMemberId, setActiveMember }
}
