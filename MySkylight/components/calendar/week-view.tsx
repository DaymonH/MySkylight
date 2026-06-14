"use client"

import { useMemo, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { OccurrenceOut } from "@/lib/types/calendar"
import type { WeatherDay } from "@/hooks/use-weather"
import { WeatherIcon } from "./weather-icon"
import { packDayEvents, minutesNow } from "./event-layout"

interface WeekViewProps {
  startDate: Date  // Sunday of the week
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
  weatherByDate?: Record<string, WeatherDay>
  large?: boolean
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const SCROLL_TO_HOUR = 7
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fmt12(h: number) {
  if (h === 0) return "12 AM"
  if (h === 12) return "12 PM"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

export function WeekView({ startDate, occurrences, onEventClick, weatherByDate, large = false }: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hourHeight = large ? 64 : 48
  const totalHeight = 24 * hourHeight

  // Re-render once a minute so the "now" line tracks real time (matters on the wall display).
  const [now, setNow] = useState(() => minutesNow())
  useEffect(() => {
    const id = setInterval(() => setNow(minutesNow()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_HOUR * hourHeight
    })
  }, [hourHeight])

  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startDate)
      d.setDate(d.getDate() + i)
      return d
    }), [startDate])

  const todayYMD = toYMD(new Date())

  const byDay = useMemo(() => {
    const map = new Map<string, OccurrenceOut[]>()
    for (const occ of occurrences) {
      const key = occ.occurrence_date
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(occ)
    }
    return map
  }, [occurrences])

  const hasAllDay = occurrences.some((o) => o.all_day)

  return (
    <div className="flex h-full flex-col">
      {/* Sticky day header */}
      <div className="bg-background z-10 grid flex-shrink-0 border-b" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}>
        <div className="border-r" />
        {days.map((d, i) => {
          const ymd = toYMD(d)
          const isToday = ymd === todayYMD
          return (
            <div key={i} className={cn("flex flex-col items-center gap-0.5 border-r py-1.5 last:border-r-0", isToday && "bg-primary/5")}>
              <div className={cn("text-xs font-medium uppercase", isToday ? "text-primary" : "text-muted-foreground")}>
                {DOW[d.getDay()]}
              </div>
              <div className={cn(
                "flex items-center justify-center rounded-full font-semibold tabular-nums",
                large ? "h-9 w-9 text-lg" : "h-7 w-7 text-sm",
                isToday && "bg-primary text-primary-foreground shadow-sm",
              )}>
                {d.getDate()}
              </div>
              {weatherByDate?.[ymd] && (
                <div className="mt-0.5 flex justify-center">
                  <WeatherIcon compact {...weatherByDate[ymd]} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* All-day row */}
      {hasAllDay && (
        <div className="grid flex-shrink-0 border-b" style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}>
          <div className="text-muted-foreground flex items-center justify-end border-r px-1.5 py-1 text-[10px] uppercase">
            All day
          </div>
          {days.map((d, i) => {
            const ymd = toYMD(d)
            const allDay = (byDay.get(ymd) ?? []).filter((o) => o.all_day)
            return (
              <div key={i} className="flex flex-col gap-0.5 border-r p-0.5 last:border-r-0">
                {allDay.map((occ, j) => (
                  <button
                    key={j}
                    onClick={() => onEventClick(occ)}
                    className="truncate rounded-md px-1.5 py-0.5 text-left text-xs font-medium text-white shadow-sm"
                    style={{ backgroundColor: occ.effective_color }}
                  >
                    {occ.title}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="thin-scrollbar flex-1 overflow-auto">
        <div className="flex" style={{ height: totalHeight }}>
          {/* Time gutter */}
          <div className="relative w-14 flex-shrink-0 border-r">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-muted-foreground absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums"
                style={{ top: h * hourHeight }}
              >
                {h === 0 ? "" : fmt12(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          <div className="grid flex-1 grid-cols-7">
            {days.map((d, i) => {
              const ymd = toYMD(d)
              const isToday = ymd === todayYMD
              const timed = (byDay.get(ymd) ?? []).filter((o) => !o.all_day)
              const positioned = packDayEvents(timed)
              return (
                <div
                  key={i}
                  className={cn("relative border-r last:border-r-0", isToday && "bg-primary/5")}
                  style={{
                    backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${hourHeight}px)`,
                  }}
                >
                  {positioned.map((p, j) => {
                    const top = (p.startMin / 60) * hourHeight
                    const height = Math.max(((p.endMin - p.startMin) / 60) * hourHeight - 2, 16)
                    const widthPct = 100 / p.cols
                    return (
                      <button
                        key={j}
                        onClick={() => onEventClick(p.occ)}
                        className="absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-white shadow-sm ring-1 ring-black/5 transition-shadow hover:z-20 hover:shadow-md"
                        style={{
                          top,
                          height,
                          left: `calc(${p.col * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          backgroundColor: p.occ.effective_color,
                        }}
                      >
                        <span className="block truncate text-xs font-medium leading-tight">{p.occ.title}</span>
                        {height > 30 && (
                          <span className="block truncate text-[10px] opacity-90">
                            {new Date(p.occ.start_dt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        )}
                      </button>
                    )
                  })}

                  {/* Now indicator */}
                  {isToday && (
                    <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: (now / 60) * hourHeight }}>
                      <div className="relative h-px bg-red-500">
                        <span className="absolute -top-1 -left-1 size-2 rounded-full bg-red-500" />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
