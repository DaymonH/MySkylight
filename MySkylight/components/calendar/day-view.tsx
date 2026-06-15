"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
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
  /** First hour shown in the time grid (0–23). Default 7 (7 AM). */
  dayStartHour?: number
  /** Last hour shown — bottom edge of grid (1–24). Default 23 (11 PM). */
  dayEndHour?: number
}

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fmt12(h: number) {
  if (h === 0) return "12 AM"
  if (h === 12) return "12 PM"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

export function DayView({
  date,
  occurrences,
  onEventClick,
  weather,
  large = false,
  dayStartHour = 7,
  dayEndHour = 23,
}: DayViewProps) {
  // Visible time window. Events outside are hidden; events overlapping are clipped.
  const startHour = Math.max(0, Math.min(23, dayStartHour))
  const endHour = Math.max(startHour + 1, Math.min(24, dayEndHour))
  const hours = useMemo(
    () =>
      Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
    [startHour, endHour]
  )

  // Fit the whole configured hour range into the available height instead of a
  // fixed per-hour size, so the day fills the pane without scrolling. Only when
  // the range is too tall to stay legible do we clamp to a minimum row height
  // (and let it scroll).
  const scrollRef = useRef<HTMLDivElement>(null)
  const [availH, setAvailH] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setAvailH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const spanHours = endHour - startHour
  const minHour = large ? 48 : 36
  const fitHour = availH ? Math.floor(availH / spanHours) : large ? 72 : 56
  const hourHeight = Math.max(minHour, fitHour)
  const totalHeight = spanHours * hourHeight
  const startMinClamp = startHour * 60
  const endMinClamp = endHour * 60

  const [now, setNow] = useState(() => minutesNow())
  useEffect(() => {
    const id = setInterval(() => setNow(minutesNow()), 60_000)
    return () => clearInterval(id)
  }, [])

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
            <span className="mr-1 text-[10px] text-muted-foreground uppercase">
              All day
            </span>
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

      {/* Hourly grid — fits the available height, scrolls only if clamped */}
      <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-auto">
        <div className="flex" style={{ height: totalHeight }}>
          {/* Time gutter */}
          <div className="relative w-16 flex-shrink-0 border-r">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
                style={{ top: (h - startHour) * hourHeight }}
              >
                {h === startHour || h === endHour ? "" : fmt12(h)}
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
              if (p.endMin <= startMinClamp || p.startMin >= endMinClamp)
                return null
              const sMin = Math.max(p.startMin, startMinClamp)
              const eMin = Math.min(p.endMin, endMinClamp)
              const top = ((sMin - startMinClamp) / 60) * hourHeight
              const height = Math.max(((eMin - sMin) / 60) * hourHeight - 2, 22)
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
                  <span
                    className={cn(
                      "truncate leading-tight font-medium",
                      large ? "text-base" : "text-sm"
                    )}
                  >
                    {p.occ.title}
                  </span>
                  {height > 34 && (
                    <span className="truncate text-xs opacity-90">
                      {start.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {end.toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
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
            {isToday && now >= startMinClamp && now <= endMinClamp && (
              <div
                className="pointer-events-none absolute inset-x-0 z-30"
                style={{ top: ((now - startMinClamp) / 60) * hourHeight }}
              >
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
