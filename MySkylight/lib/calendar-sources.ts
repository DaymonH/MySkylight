import type { OccurrenceOut } from "@/lib/types/calendar"
import type { ExternalAccountOut, ExternalProvider } from "@/lib/types/external"

// The native "MySkylight" calendar — events created in-app, with no external
// source. Every occurrence with `source.kind === "local"` belongs to it.
export const LOCAL_CALENDAR_KEY = "local"
export const LOCAL_CALENDAR_NAME = "MySkylight"

export interface CalendarSource {
  /** Stable id used as the filter key: `LOCAL_CALENDAR_KEY` or an external calendar id. */
  key: string
  name: string
  /** Swatch color; null for the local calendar (its events carry their own colors). */
  color: string | null
  provider: ExternalProvider | "local"
  accountEmail: string | null
}

/**
 * Every calendar that can currently put events on the view: the native
 * "MySkylight" calendar plus each *synced* external calendar. Unsynced calendars
 * are omitted — the backend returns none of their events, so there'd be nothing
 * to toggle. Local is always first.
 */
export function buildCalendarSources(
  accounts: ExternalAccountOut[],
): CalendarSource[] {
  const sources: CalendarSource[] = [
    {
      key: LOCAL_CALENDAR_KEY,
      name: LOCAL_CALENDAR_NAME,
      color: null,
      provider: "local",
      accountEmail: null,
    },
  ]
  for (const account of accounts) {
    for (const cal of account.calendars) {
      if (!cal.synced) continue
      sources.push({
        key: cal.id,
        name: cal.name,
        color: cal.color,
        provider: account.provider,
        accountEmail: account.account_email,
      })
    }
  }
  return sources
}

// Fallback key for a mirror occurrence we can't match to a known calendar (e.g.
// its account list hasn't loaded yet). Stable for a given source so toggling is
// still coherent; kept distinct from real calendar ids by the `ext:` prefix.
function syntheticKey(o: OccurrenceOut): string {
  return `ext:${o.source.provider ?? "?"}|${o.source.account_email ?? ""}|${o.source.label}`
}

/**
 * The calendar-source key an occurrence belongs to, matching the keys from
 * `buildCalendarSources`. Local → `LOCAL_CALENDAR_KEY`; a mirror → its external
 * calendar's id, matched by provider + account + calendar name (the backend
 * sets `source.label` to the external calendar's name).
 */
export function occurrenceCalendarKey(
  o: OccurrenceOut,
  accounts: ExternalAccountOut[],
): string {
  if (o.source.kind === "local") return LOCAL_CALENDAR_KEY
  for (const account of accounts) {
    if (account.provider !== o.source.provider) continue
    if ((account.account_email ?? null) !== (o.source.account_email ?? null)) continue
    const cal = account.calendars.find((c) => c.name === o.source.label)
    if (cal) return cal.id
  }
  return syntheticKey(o)
}
