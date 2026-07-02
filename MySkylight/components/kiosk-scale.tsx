"use client"

import { useEffect } from "react"

/**
 * Marks the document as the kiosk surface so `html[data-surface="device"]`
 * (see globals.css) applies the `--kiosk-scale` root font-size bump, scaling
 * the whole wall-display UI up from the phone/tablet `/app` size.
 *
 * The root <html> lives in the app-wide root layout, so the nested /device
 * layout can't set the attribute in markup — we set it on mount and clean it
 * up on unmount (leaving /device back to /app). Renders nothing.
 */
export function KioskScale() {
  useEffect(() => {
    document.documentElement.dataset.surface = "device"
    return () => {
      delete document.documentElement.dataset.surface
    }
  }, [])

  return null
}
