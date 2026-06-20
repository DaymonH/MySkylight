export interface MemberBrief {
  id: string
  name: string
  color: string
}

export interface EventOut {
  id: string
  /** Source external calendar when this is a read-only mirror; null for native events. */
  external_calendar_id: string | null
  family_id: string
  title: string
  description: string | null
  location: string | null
  start_dt: string
  end_dt: string
  all_day: boolean
  rrule: string | null
  color: string | null
  is_countdown: boolean
  /** True for events mirrored read-only from a connected external calendar (F18/F20). */
  read_only: boolean
  created_at: string
  updated_at: string
  members: MemberBrief[]
  reminder_minutes: number[]
}

export interface OccurrenceOut {
  event_id: string
  occurrence_date: string  // YYYY-MM-DD
  start_dt: string
  end_dt: string
  title: string
  description: string | null
  location: string | null
  all_day: boolean
  is_countdown: boolean
  is_exception: boolean
  is_recurring: boolean
  /** True when this occurrence belongs to a read-only external mirror (F18/F20). */
  read_only: boolean
  effective_color: string
  members: MemberBrief[]
  reminder_minutes: number[]
  days_until: number | null
}

export type CalendarView = "month" | "week" | "day" | "schedule"

export interface EventCreatePayload {
  title: string
  description?: string
  location?: string
  start_dt: string
  end_dt: string
  all_day?: boolean
  rrule?: string
  color?: string
  is_countdown?: boolean
  member_ids?: string[]
  reminder_minutes?: number[]
}

export interface EventUpdatePayload extends Partial<EventCreatePayload> {
  edit_mode?: "this" | "following" | "all"
  occurrence_date?: string
}
