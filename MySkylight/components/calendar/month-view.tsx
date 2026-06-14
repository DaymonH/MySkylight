"use client"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import type { OccurrenceOut } from "@/lib/types/calendar"
import { EventDot } from "./event-dot"

interface MonthViewProps {
  year: number
  month: number  // 0-based
  occurrences: OccurrenceOut[]
  onDayClick: (date: string) => void
  onEventClick: (occ: OccurrenceOut) => void
  large?: boolean
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function MonthView({ year, month, occurrences, onDayClick, onEventClick, large = false }: MonthViewProps) {
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

  const maxVisible = large ? 5 : 3

  return (
    <div className="flex h-full flex-col">
      {/* Weekday headers */}
      <div className="bg-background sticky top-0 z-10 grid grid-cols-7 border-b">
        {DOW_LABELS.map((d, i) => (
          <div
            key={d}
            className={cn(
              "py-1.5 text-center text-xs font-semibold tracking-wide uppercase",
              i === 0 || i === 6 ? "text-muted-foreground/70" : "text-muted-foreground",
            )}
          >
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d[0]}</span>
          </div>
        ))}
      </div>

      {/* Weeks */}
      <div className="grid flex-1 auto-rows-fr">
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <div key={row} className="grid grid-cols-7 border-b last:border-b-0">
            {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
              const isWeekend = col === 0 || col === 6
              if (!day) return <div key={col} className="bg-muted/40 border-r last:border-r-0" />
              const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
              const evts = byDay.get(ymd) ?? []
              const isToday = ymd === today

              return (
                <button
                  key={col}
                  type="button"
                  className={cn(
                    "hover:bg-accent/60 focus-visible:ring-ring/40 group flex flex-col items-stretch border-r p-1 text-left transition-colors outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset",
                    large ? "min-h-[7rem]" : "min-h-[5rem]",
                    isWeekend && !isToday && "bg-muted/20",
                  )}
                  onClick={() => onDayClick(ymd)}
                >
                  <span
                    className={cn(
                      "mb-0.5 inline-flex items-center justify-center rounded-full font-medium tabular-nums",
                      large ? "h-8 w-8 text-base" : "h-6 w-6 text-sm",
                      isToday
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-foreground group-hover:bg-background/60",
                    )}
                  >
                    {day}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    {evts.slice(0, maxVisible).map((occ, i) => (
                      <div
                        key={i}
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => { e.stopPropagation(); onEventClick(occ) }}
                      >
                        <EventDot
                          colors={occ.members.length ? occ.members.map((m) => m.color) : [occ.effective_color]}
                          title={occ.title}
                          large={large}
                        />
                      </div>
                    ))}
                    {evts.length > maxVisible && (
                      <span className={cn("text-muted-foreground pl-1 font-medium", large ? "text-sm" : "text-xs")}>
                        +{evts.length - maxVisible} more
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
