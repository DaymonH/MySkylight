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
  /** Jump to the day view for a date (used by the "+N more" overflow). */
  onViewDay?: (date: string) => void
  large?: boolean
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function MonthView({ year, month, occurrences, onDayClick, onEventClick, onViewDay, large = false }: MonthViewProps) {
  const today = toYMD(new Date())

  // Full grid of weeks, padded with the adjacent months' days so the calendar
  // reads as a complete block rather than trailing off into empty cells.
  const cells = useMemo(() => {
    const startOffset = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const prevMonthDays = new Date(year, month, 0).getDate()
    const out: { date: Date; inMonth: boolean }[] = []
    for (let i = startOffset - 1; i >= 0; i--) {
      out.push({ date: new Date(year, month - 1, prevMonthDays - i), inMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ date: new Date(year, month, d), inMonth: true })
    }
    for (let d = 1; out.length % 7 !== 0; d++) {
      out.push({ date: new Date(year, month + 1, d), inMonth: false })
    }
    return out
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
            {cells.slice(row * 7, row * 7 + 7).map(({ date, inMonth }, col) => {
              const isWeekend = col === 0 || col === 6
              const ymd = toYMD(date)

              // Adjacent-month days: shown faded for visual completeness, no events.
              if (!inMonth) {
                return (
                  <div
                    key={col}
                    className={cn(
                      "border-r p-1 last:border-r-0",
                      large ? "min-h-[7rem]" : "min-h-[5rem]",
                      "bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center justify-center font-medium tabular-nums text-muted-foreground/40",
                        large ? "h-8 w-8 text-base" : "h-6 w-6 text-sm",
                      )}
                    >
                      {date.getDate()}
                    </span>
                  </div>
                )
              }

              const evts = byDay.get(ymd) ?? []
              const isToday = ymd === today

              return (
                <button
                  key={col}
                  type="button"
                  className={cn(
                    "hover:bg-accent/60 active:bg-accent focus-visible:ring-ring/40 group flex flex-col items-stretch border-r p-1 text-left transition-colors outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset",
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
                    {date.getDate()}
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
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => { e.stopPropagation(); (onViewDay ?? onDayClick)(ymd) }}
                        className={cn(
                          "text-muted-foreground hover:text-foreground rounded pl-1 font-medium transition-colors",
                          large ? "text-sm" : "text-xs",
                        )}
                      >
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
