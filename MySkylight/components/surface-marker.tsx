"use client"

import { useEffect } from "react"

export type Surface = "app" | "device"

export const SURFACE_STORAGE_KEY = "skylight:surface"

/**
 * Records which surface (`/app` phone companion vs `/device` kiosk) this
 * install last used, so the root route can send a bare `/` load back to the
 * right place. Without this, a kiosk that ever lands on `/` — an already-signed-
 * in re-auth, a kiosk-browser reload of the origin — falls through to `/app`.
 */
export function SurfaceMarker({ surface }: { surface: Surface }) {
  useEffect(() => {
    try {
      localStorage.setItem(SURFACE_STORAGE_KEY, surface)
    } catch {
      // Private mode / storage disabled — root just falls back to its default.
    }
  }, [surface])
  return null
}
