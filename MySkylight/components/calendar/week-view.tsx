"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { readableTextOn } from "@/lib/colors"
import type { OccurrenceOut } from "@/lib/types/calendar"
import type { WeatherDay } from "@/hooks/use-weather"
import { WeatherIcon } from "./weather-icon"
import { packDayEvents, minutesNow, slotTimeFromOffset } from "./event-layout"
import { NowLine } from "./now-line"
import { useTodayYMD } from "@/hooks/use-today"

interface WeekViewProps {
  startDate: Date // Sunday of the week
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
  /** Tap an empty spot in a day column: start a new event at that date + time. */
  onSlotClick?: (date: string, time: string) => void
  weatherByDate?: Record<string, WeatherDay>
  large?: boolean
  /** First hour shown in the time grid (0–23). Default 7 (7 AM). */
  dayStartHour?: number
  /** Last hour shown — bottom edge of grid (1–24). Default 23 (11 PM). */
  dayEndHour?: number
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fmt12(h: number) {
  if (h === 0) return "12 AM"
  if (h === 12) return "12 PM"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

export function WeekView({
  startDate,
  occurrences,
  onEventClick,
  onSlotClick,
  weatherByDate,
  large = false,
  dayStartHour = 7,
  dayEndHour = 23,
}: WeekViewProps) {
  // Visible time window. Events outside are hidden; events overlapping are clipped.
  const startHour = Math.max(0, Math.min(23, dayStartHour))
  const endHour = Math.max(startHour + 1, Math.min(24, dayEndHour))
  const hours = useMemo(
    () =>
      Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i),
    [startHour, endHour]
  )
  // Fit the whole configured hour range into the available height instead of a
  // fixed per-hour size, so the week fills the pane without scrolling. Only when
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
  const minHour = large ? 40 : 28
  const fitHour = availH ? Math.floor(availH / spanHours) : large ? 64 : 48
  const hourHeight = Math.max(minHour, fitHour)
  const totalHeight = spanHours * hourHeight
  const startMinClamp = startHour * 60
  const endMinClamp = endHour * 60

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startDate)
        d.setDate(d.getDate() + i)
        return d
      }),
    [startDate]
  )

  const todayYMD = useTodayYMD()

  // On a phone the grid scrolls (the hour range doesn't fit), and opening at the top
  // of the morning hides what's happening now. When this week contains today, land
  // the "now" line about a third of the way down. The wall display fits the whole
  // range without scrolling, so this is a no-op there.
  const weekHasToday = days.some((d) => toYMD(d) === todayYMD)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !weekHasToday || availH == null) return
    if (el.scrollHeight <= el.clientHeight + 1) return
    const nowMin = minutesNow()
    if (nowMin < startMinClamp || nowMin > endMinClamp) return
    const y = ((nowMin - startMinClamp) / 60) * hourHeight
    el.scrollTop = Math.max(0, y - el.clientHeight / 3)
  }, [availH, weekHasToday]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <div
        className="z-10 grid flex-shrink-0 border-b bg-background"
        style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}
      >
        <div className="border-r" />
        {days.map((d, i) => {
          const ymd = toYMD(d)
          const isToday = ymd === todayYMD
          return (
            <div
              key={i}
              className={cn(
                "flex flex-col items-center gap-0.5 border-r py-1.5 last:border-r-0",
                isToday && "bg-primary/5"
              )}
            >
              <div
                className={cn(
                  "text-xs font-medium uppercase",
                  isToday ? "text-primary" : "text-muted-foreground"
                )}
              >
                {DOW[d.getDay()]}
              </div>
              <div
                className={cn(
                  "flex items-center justify-center rounded-full font-semibold tabular-nums",
                  large ? "h-9 w-9 text-lg" : "h-7 w-7 text-sm",
                  isToday && "bg-primary text-primary-foreground shadow-sm"
                )}
              >
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
        <div
          className="grid flex-shrink-0 border-b"
          style={{ gridTemplateColumns: "3.5rem repeat(7, 1fr)" }}
        >
          <div className="flex items-center justify-end border-r px-1.5 py-1 text-[10px] text-muted-foreground uppercase">
            All day
          </div>
          {days.map((d, i) => {
            const ymd = toYMD(d)
            const allDay = (byDay.get(ymd) ?? []).filter((o) => o.all_day)
            return (
              <div
                key={i}
                className="flex flex-col gap-0.5 border-r p-0.5 last:border-r-0"
              >
                {allDay.map((occ, j) => (
                  <button
                    key={j}
                    onClick={() => onEventClick(occ)}
                    className="truncate rounded-md px-1.5 py-0.5 text-left text-xs font-medium shadow-sm ring-1 ring-black/5 transition-shadow active:shadow-md"
                    style={{
                      backgroundColor: occ.effective_color,
                      color: readableTextOn(occ.effective_color),
                    }}
                  >
                    {occ.title}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Time grid — fits the available height, scrolls only if clamped */}
      <div ref={scrollRef} className="thin-scrollbar min-h-0 flex-1 overflow-auto">
        <div className="flex" style={{ height: totalHeight }}>
          {/* Time gutter */}
          <div className="relative w-14 flex-shrink-0 border-r">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums"
                style={{ top: (h - startHour) * hourHeight }}
              >
                {h === startHour || h === endHour ? "" : fmt12(h)}
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
                  className={cn(
                    "relative border-r last:border-r-0",
                    isToday && "bg-primary/5"
                  )}
                  onClick={
                    onSlotClick
                      ? (e) => {
                          // Events are buttons; only an empty spot starts a new one.
                          if ((e.target as HTMLElement).closest("button")) return
                          const top = e.currentTarget.getBoundingClientRect().top
                          onSlotClick(
                            ymd,
                            slotTimeFromOffset(
                              e.clientY - top,
                              startMinClamp,
                              endMinClamp,
                              hourHeight,
                            ),
                          )
                        }
                      : undefined
                  }
                >
                  {/* Hour gridlines as real bordered rows. These paint crisply at
                      any browser zoom / OS display-scaling, whereas a repeating
                      linear-gradient drops whole bands of 1px lines on sub-pixel
                      rounding (the "missing 2–5pm lines" bug). */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col">
                    {Array.from({ length: spanHours }, (_, h) => (
                      <div
                        key={h}
                        className="border-t border-border"
                        style={{ height: hourHeight }}
                      />
                    ))}
                  </div>
                  {positioned.map((p, j) => {
                    if (p.endMin <= startMinClamp || p.startMin >= endMinClamp)
                      return null
                    const sMin = Math.max(p.startMin, startMinClamp)
                    const eMin = Math.min(p.endMin, endMinClamp)
                    const top = ((sMin - startMinClamp) / 60) * hourHeight
                    const height = Math.max(
                      ((eMin - sMin) / 60) * hourHeight - 2,
                      16
                    )
                    const widthPct = 100 / p.cols
                    return (
                      <button
                        key={j}
                        onClick={() => onEventClick(p.occ)}
                        className="absolute z-10 overflow-hidden rounded-md px-1.5 py-0.5 text-left shadow-sm ring-1 ring-black/5 transition-shadow hover:z-20 hover:shadow-md active:shadow-md"
                        style={{
                          top,
                          height,
                          left: `calc(${p.col * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          backgroundColor: p.occ.effective_color,
                          color: readableTextOn(p.occ.effective_color),
                        }}
                      >
                        <span className="block truncate text-xs leading-tight font-medium">
                          {p.occ.title}
                        </span>
                        {height > 30 && (
                          <span className="block truncate text-[10px] opacity-90">
                            {new Date(p.occ.start_dt).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </button>
                    )
                  })}

                  {/* Now indicator */}
                  {isToday && (
                    <NowLine
                      startMin={startMinClamp}
                      endMin={endMinClamp}
                      hourHeight={hourHeight}
                    />
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
