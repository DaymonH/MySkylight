"use client"

import { useCallback, useSyncExternalStore } from "react"

const STORAGE_KEY = "skylight:settings:palette"
const CHANGE_EVENT = "skylight:palette-changed"
const ATTR = "data-palette"

/**
 * Selectable color themes. Each id has matching `[data-palette="id"]` (light) and
 * `[data-palette="id"].dark` blocks in `globals.css`. `coral` is the default and
 * maps to the base `:root` / `.dark` tokens (no override block).
 *
 * `swatch` colors mirror each theme's tokens and are used only to render the
 * picker chips in settings — keep them roughly in sync with `globals.css`.
 */
export const PALETTES = [
  {
    id: "coral",
    name: "Coral",
    hint: "Warm coral · cool slate",
    swatch: { light: "oklch(0.971 0.015 73)", dark: "oklch(0.205 0.008 265)", accent: "oklch(0.62 0.185 33)" },
  },
  {
    id: "hearth",
    name: "Hearth",
    hint: "Cozy warm · brown dark",
    swatch: { light: "oklch(0.968 0.022 66)", dark: "oklch(0.2 0.012 50)", accent: "oklch(0.71 0.17 35)" },
  },
  {
    id: "midnight",
    name: "Midnight",
    hint: "Crisp white · deep dark",
    swatch: { light: "oklch(0.99 0.002 250)", dark: "oklch(0.155 0.006 265)", accent: "oklch(0.62 0.185 33)" },
  },
  {
    id: "graphite",
    name: "Graphite",
    hint: "Neutral grey",
    swatch: { light: "oklch(0.975 0 0)", dark: "oklch(0.205 0 0)", accent: "oklch(0.62 0.185 33)" },
  },
  {
    id: "ocean",
    name: "Ocean",
    hint: "Teal accent",
    swatch: { light: "oklch(0.985 0.008 215)", dark: "oklch(0.205 0.006 250)", accent: "oklch(0.6 0.105 195)" },
  },
  {
    id: "berry",
    name: "Berry",
    hint: "Raspberry accent",
    swatch: { light: "oklch(0.985 0.01 350)", dark: "oklch(0.205 0.007 330)", accent: "oklch(0.585 0.21 5)" },
  },
  {
    id: "meadow",
    name: "Meadow",
    hint: "Green accent",
    swatch: { light: "oklch(0.984 0.014 130)", dark: "oklch(0.2 0.008 160)", accent: "oklch(0.58 0.14 150)" },
  },
] as const

export type PaletteId = (typeof PALETTES)[number]["id"]

export const DEFAULT_PALETTE: PaletteId = "coral"

function isPaletteId(v: string | null): v is PaletteId {
  return !!v && PALETTES.some((p) => p.id === v)
}

function apply(id: PaletteId) {
  document.documentElement.setAttribute(ATTR, id)
}

// External-store glue for `useSyncExternalStore` (mirrors `use-visible-hours`).
// Module-level so references stay stable. Only runs on the client.
function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      // Keep the <html> attribute in sync when another tab changes the theme.
      apply(getSnapshot())
      onChange()
    }
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onStorage)
  }
}

function getSnapshot(): PaletteId {
  const v = localStorage.getItem(STORAGE_KEY)
  return isPaletteId(v) ? v : DEFAULT_PALETTE
}

function getServerSnapshot(): PaletteId {
  return DEFAULT_PALETTE
}

/**
 * Shared color-theme preference. Backed by `localStorage`, applied to the
 * `<html data-palette>` attribute (also set pre-hydration by an inline script in
 * the root layout to avoid a flash), and broadcast so the settings UI and every
 * surface stay in sync. Orthogonal to light/dark/system (which `next-themes` owns).
 */
export function usePalette() {
  const palette = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const setPalette = useCallback((id: PaletteId) => {
    localStorage.setItem(STORAGE_KEY, id)
    apply(id)
    // "storage" only fires in *other* tabs; this drives our own re-read.
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return { palette, setPalette }
}
