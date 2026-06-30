// External calendar sync (read-only / one-way pull) — F18 Google, F20 Apple.
// A connected `ExternalAccount` exposes one or more discovered calendars; each
// can be mapped to a local calendar, at which point its events are mirrored in
// read-only. Mirror events surface on the calendar as ordinary occurrences with
// `read_only: true` (see lib/types/calendar.ts) — shown but never editable here.

// "ics" = a subscribed iCalendar feed URL (e.g. US Holidays), grouped under one
// per-family container account. No auth — the scheduler re-fetches the feed.
export type ExternalProvider = "google" | "apple" | "ics"
export type ExternalAccountStatus = "active" | "needs_reauth"

export interface ExternalCalendarOut {
  id: string
  external_id: string
  name: string
  color: string | null
  /** Whether this calendar is actively mirrored in (the on/off toggle). */
  synced: boolean
  last_synced_at: string | null
}

export interface ExternalAccountOut {
  id: string
  provider: ExternalProvider
  account_email: string | null
  status: ExternalAccountStatus
  last_synced_at: string | null
  created_at: string
  calendars: ExternalCalendarOut[]
}

/** Google consent URL to open to start the OAuth connect flow. */
export interface AuthorizeUrlOut {
  authorize_url: string
}

/** Subscribe to a read-only iCalendar (.ics) feed by URL (e.g. US Holidays). */
export interface IcsFeedConnectIn {
  url: string
  /** Optional label; defaults to the feed's own name server-side. */
  name?: string
  /** Optional #RRGGBB tint for the feed's events. */
  color?: string
}

/** Outcome of an on-demand pull. */
export interface ExternalSyncResult {
  account_id: string
  status: ExternalAccountStatus
  calendars_synced: number
  created: number
  updated: number
  deleted: number
}
