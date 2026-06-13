"use client"

import type { OccurrenceOut } from "@/lib/types/calendar"

interface ScheduleViewProps {
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00")
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
}

function formatTime(dtStr: string, allDay: boolean) {
  if (allDay) return "All day"
  return new Date(dtStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function ScheduleView({ occurrences, onEventClick }: ScheduleViewProps) {
  if (occurrences.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
        <p className="text-sm">No upcoming events</p>
      </div>
    )
  }

  // Group by date
  const groups = new Map<string, OccurrenceOut[]>()
  for (const occ of occurrences) {
    const key = occ.occurrence_date
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(occ)
  }

  return (
    <div className="flex flex-col divide-y">
      {[...groups.entries()].map(([date, evts]) => (
        <div key={date} className="flex gap-4 px-4 py-3">
          <div className="w-24 flex-shrink-0 pt-0.5 text-sm text-muted-foreground">
            {formatDate(date)}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            {evts.map((occ, i) => (
              <button
                key={i}
                onClick={() => onEventClick(occ)}
                className="flex items-start gap-2 rounded-lg p-2 text-left hover:bg-accent"
              >
                <div
                  className="mt-1 h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: occ.effective_color }}
                />
                <div className="flex-1">
                  <p className="font-medium leading-snug">{occ.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTime(occ.start_dt, occ.all_day)}
                    {occ.location && ` · ${occ.location}`}
                  </p>
                  {occ.is_countdown && occ.days_until !== null && (
                    <p className="mt-0.5 text-xs font-medium" style={{ color: occ.effective_color }}>
                      {occ.days_until === 0 ? "Today!" : occ.days_until > 0 ? `${occ.days_until} days away` : "Past"}
                    </p>
                  )}
                </div>
                {occ.members.length > 0 && (
                  <div className="flex -space-x-1">
                    {occ.members.slice(0, 3).map((m) => (
                      <div
                        key={m.id}
                        className="h-5 w-5 rounded-full border-2 border-background"
                        style={{ backgroundColor: m.color }}
                        title={m.name}
                      />
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
