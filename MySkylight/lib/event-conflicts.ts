import type { MemberBrief, OccurrenceOut } from "@/lib/types/calendar"

export interface EventConflict {
  member: MemberBrief
  occurrence: OccurrenceOut
}

/**
 * Who's double-booked: for each selected member, the timed events they're already
 * on that overlap `[start, end)`. Touching edges (one ends as the next starts) are
 * not an overlap. All-day events never conflict, `ignoreEventId` excludes the event
 * being edited (including its other occurrences), and an event with no members is
 * family-wide, so it conflicts with nobody. Only a warning — callers don't block.
 */
export function findConflicts(
  existing: OccurrenceOut[],
  opts: {
    start: Date
    end: Date
    memberIds: string[]
    allDay: boolean
    ignoreEventId?: string
  },
): EventConflict[] {
  const { start, end, memberIds, allDay, ignoreEventId } = opts
  if (allDay || memberIds.length === 0) return []
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return []

  const wanted = new Set(memberIds)
  const out: EventConflict[] = []
  const seen = new Set<string>()
  for (const o of existing) {
    if (o.all_day || o.event_id === ignoreEventId) continue
    const s = new Date(o.start_dt)
    const e = new Date(o.end_dt)
    if (!(s < end && e > start)) continue
    for (const m of o.members) {
      if (!wanted.has(m.id)) continue
      const key = `${m.id}:${o.event_id}:${o.occurrence_date}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ member: m, occurrence: o })
    }
  }
  return out
}
