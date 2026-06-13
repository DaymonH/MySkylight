"use client"

import { useMemo } from "react"
import type { OccurrenceOut } from "@/lib/types/calendar"
import { EventDot } from "./event-dot"

interface MonthViewProps {
  year: number
  month: number  // 0-based
  occurrences: OccurrenceOut[]
  onDayClick: (date: string) => void
  onEventClick: (occ: OccurrenceOut) => void
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function MonthView({ year, month, occurrences, onDayClick, onEventClick }: MonthViewProps) {
  const today = toYMD(new Date())

  const { days, startOffset } = useMemo(() => {
    const firstDay = new Date(year, month, 1)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    return { days: daysInMonth, startOffset: firstDay.getDay() }
  }, [year, month])

  const byDay = useMemo(() => {
    const map = new Map<string, OccurrenceOut[]>()
    for (const occ of occurrences) {
      const key = occ.occurrence_date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(occ)
    }
    return map
  }, [occurrences])

  const cells: (null | number)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ]
  // pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="flex flex-col gap-0">
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b">
        {DOW_LABELS.map((d) => (
          <div key={d} className="py-1 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Weeks */}
      {Array.from({ length: cells.length / 7 }, (_, row) => (
        <div key={row} className="grid grid-cols-7 border-b last:border-b-0">
          {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
            if (!day) return <div key={col} className="border-r bg-muted/30 p-1 last:border-r-0" />
            const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            const evts = byDay.get(ymd) ?? []
            const isToday = ymd === today

            return (
              <div
                key={col}
                className="min-h-[5rem] cursor-pointer border-r p-1 last:border-r-0 hover:bg-accent/50"
                onClick={() => onDayClick(ymd)}
              >
                <span
                  className={`mb-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium ${
                    isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {day}
                </span>
                <div className="flex flex-col gap-0.5">
                  {evts.slice(0, 3).map((occ, i) => (
                    <div
                      key={i}
                      onClick={(e) => { e.stopPropagation(); onEventClick(occ) }}
                    >
                      <EventDot
                        colors={occ.members.length ? occ.members.map((m) => m.color) : [occ.effective_color]}
                        title={occ.title}
                      />
                    </div>
                  ))}
                  {evts.length > 3 && (
                    <span className="text-xs text-muted-foreground">+{evts.length - 3} more</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
