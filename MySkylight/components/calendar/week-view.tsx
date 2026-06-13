"use client"

import { useMemo, useEffect, useRef } from "react"
import type { OccurrenceOut } from "@/lib/types/calendar"
import type { WeatherDay } from "@/hooks/use-weather"
import { WeatherIcon } from "./weather-icon"

interface WeekViewProps {
  startDate: Date  // Sunday of the week
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
  weatherByDate?: Record<string, WeatherDay>
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const HOUR_HEIGHT_PX = 48  // matches minHeight: "3rem"
const SCROLL_TO_HOUR = 7

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fmt12(h: number) {
  if (h === 0) return "12am"
  if (h === 12) return "12pm"
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

export function WeekView({ startDate, occurrences, onEventClick, weatherByDate }: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = SCROLL_TO_HOUR * HOUR_HEIGHT_PX
      }
    })
  }, [])

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

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  return (
    <div className="flex h-full flex-col">
      {/* Sticky day header */}
      <div className="grid flex-shrink-0 border-b bg-background" style={{ gridTemplateColumns: "3rem repeat(7, 1fr)" }}>
        <div className="border-r" />
        {days.map((d, i) => {
          const ymd = toYMD(d)
          const isToday = ymd === todayYMD
          return (
            <div key={i} className="border-r py-1 text-center last:border-r-0">
              <div className="text-xs text-muted-foreground">{DOW[d.getDay()]}</div>
              <div className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${isToday ? "bg-primary text-primary-foreground" : ""}`}>
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

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {HOURS.map((h) => (
          <div
            key={h}
            className="grid border-b"
            style={{ gridTemplateColumns: "3rem repeat(7, 1fr)", minHeight: `${HOUR_HEIGHT_PX}px` }}
          >
            <div className="border-r px-1 pt-0.5 text-right text-xs text-muted-foreground">
              {fmt12(h)}
            </div>
            {days.map((d, i) => {
              const ymd = toYMD(d)
              const evts = (byDay.get(ymd) ?? []).filter((occ) => {
                const start = new Date(occ.start_dt)
                return start.getHours() === h
              })
              return (
                <div key={i} className="relative border-r last:border-r-0">
                  {evts.map((occ, j) => (
                    <button
                      key={j}
                      onClick={() => onEventClick(occ)}
                      className="absolute inset-x-0.5 top-0.5 z-10 truncate rounded px-1 py-0.5 text-left text-xs text-white"
                      style={{ backgroundColor: occ.effective_color }}
                    >
                      {occ.title}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
