"use client"

import { useEffect, useRef, useState } from "react"
import { MapPinIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { OccurrenceOut } from "@/lib/types/calendar"
import type { WeatherDay } from "@/hooks/use-weather"
import { WeatherIcon } from "./weather-icon"
import { packDayEvents, minutesNow } from "./event-layout"

interface DayViewProps {
  date: Date
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
  weather?: WeatherDay
  large?: boolean
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const SCROLL_TO_HOUR = 7

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fmt12(h: number) {
  if (h === 0) return "12 AM"
  if (h === 12) return "12 PM"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

export function DayView({ date, occurrences, onEventClick, weather, large = false }: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hourHeight = large ? 72 : 56
  const totalHeight = 24 * hourHeight

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

  const isToday = toYMD(date) === toYMD(new Date())
  const allDay = occurrences.filter((o) => o.all_day)
  const timed = occurrences.filter((o) => !o.all_day)
  const positioned = packDayEvents(timed)

  return (
    <div className="flex h-full flex-col">
      {/* Weather + all-day strip */}
      <div className="flex-shrink-0">
        {weather && (
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <WeatherIcon {...weather} />
          </div>
        )}
        {allDay.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
            <span className="text-muted-foreground mr-1 text-[10px] uppercase">All day</span>
            {allDay.map((occ, i) => (
              <button
                key={i}
                onClick={() => onEventClick(occ)}
                className="rounded-md px-2 py-0.5 text-xs font-medium text-white shadow-sm"
                style={{ backgroundColor: occ.effective_color }}
              >
                {occ.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Scrollable hourly grid */}
      <div ref={scrollRef} className="thin-scrollbar flex-1 overflow-auto">
        <div className="flex" style={{ height: totalHeight }}>
          {/* Time gutter */}
          <div className="relative w-16 flex-shrink-0 border-r">
            {HOURS.map((h) => (
              <div
                key={h}
                className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[11px] tabular-nums"
                style={{ top: h * hourHeight }}
              >
                {h === 0 ? "" : fmt12(h)}
              </div>
            ))}
          </div>

          {/* Event column */}
          <div
            className="relative flex-1"
            style={{
              backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${hourHeight}px)`,
            }}
          >
            {positioned.map((p, i) => {
              const top = (p.startMin / 60) * hourHeight
              const height = Math.max(((p.endMin - p.startMin) / 60) * hourHeight - 2, 22)
              const widthPct = 100 / p.cols
              const start = new Date(p.occ.start_dt)
              const end = new Date(p.occ.end_dt)
              return (
                <button
                  key={i}
                  onClick={() => onEventClick(p.occ)}
                  className="absolute z-10 flex flex-col overflow-hidden rounded-lg px-2.5 py-1 text-left text-white shadow-sm ring-1 ring-black/5 transition-shadow hover:z-20 hover:shadow-md"
                  style={{
                    top,
                    height,
                    left: `calc(${p.col * widthPct}% + 4px)`,
                    width: `calc(${widthPct}% - 8px)`,
                    backgroundColor: p.occ.effective_color,
                  }}
                >
                  <span className={cn("truncate font-medium leading-tight", large ? "text-base" : "text-sm")}>
                    {p.occ.title}
                  </span>
                  {height > 34 && (
                    <span className="truncate text-xs opacity-90">
                      {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} –{" "}
                      {end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </span>
                  )}
                  {height > 54 && p.occ.location && (
                    <span className="flex items-center gap-1 truncate text-xs opacity-80">
                      <MapPinIcon className="size-3 shrink-0" />
                      {p.occ.location}
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
        </div>
      </div>
    </div>
  )
}
