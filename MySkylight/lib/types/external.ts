// External calendar sync (read-only / one-way pull) — F18 Google, F20 Apple.
// A connected `ExternalAccount` exposes one or more discovered calendars; each
// can be mapped to a local calendar, at which point its events are mirrored in
// read-only. Mirror events surface on the calendar as ordinary occurrences with
// `read_only: true` (see lib/types/calendar.ts) — shown but never editable here.

export type ExternalProvider = "google" | "apple"
export type ExternalAccountStatus = "active" | "needs_reauth"

export interface ExternalCalendarOut {
  id: string
  external_id: string
  name: string
  color: string | null
  /** The local calendar this external one mirrors into; null = not synced. */
  calendar_id: string | null
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

/** Outcome of an on-demand pull. */
export interface ExternalSyncResult {
  account_id: string
  status: ExternalAccountStatus
  calendars_synced: number
  created: number
  updated: number
  deleted: number
}
