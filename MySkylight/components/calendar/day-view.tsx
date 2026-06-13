"use client"

import type { OccurrenceOut } from "@/lib/types/calendar"

interface DayViewProps {
  date: Date
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function fmt12(h: number) {
  if (h === 0) return "12 AM"
  if (h === 12) return "12 PM"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

export function DayView({ date, occurrences, onEventClick }: DayViewProps) {
  return (
    <div className="flex flex-col overflow-auto">
      {/* All-day strip */}
      {occurrences.filter((o) => o.all_day).length > 0 && (
        <div className="flex flex-wrap gap-1 border-b px-4 py-2">
          {occurrences.filter((o) => o.all_day).map((occ, i) => (
            <button
              key={i}
              onClick={() => onEventClick(occ)}
              className="rounded px-2 py-0.5 text-xs text-white"
              style={{ backgroundColor: occ.effective_color }}
            >
              {occ.title}
            </button>
          ))}
        </div>
      )}

      {/* Hourly slots */}
      {HOURS.map((h) => {
        const evts = occurrences.filter((o) => !o.all_day && new Date(o.start_dt).getHours() === h)
        return (
          <div key={h} className="flex min-h-12 border-b last:border-b-0">
            <div className="w-16 flex-shrink-0 px-2 pt-1 text-right text-xs text-muted-foreground">
              {fmt12(h)}
            </div>
            <div className="flex flex-1 flex-col gap-1 p-1">
              {evts.map((occ, i) => {
                const start = new Date(occ.start_dt)
                const end = new Date(occ.end_dt)
                const startStr = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                const endStr = end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                return (
                  <button
                    key={i}
                    onClick={() => onEventClick(occ)}
                    className="flex flex-col rounded px-2 py-1 text-left text-white"
                    style={{ backgroundColor: occ.effective_color }}
                  >
                    <span className="font-medium">{occ.title}</span>
                    <span className="text-xs opacity-90">{startStr} – {endStr}</span>
                    {occ.location && <span className="text-xs opacity-80">{occ.location}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
