"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { OccurrenceOut } from "@/lib/types/calendar"
import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  /**
   * Phone layout: each day shows colored dots instead of (unreadable) truncated
   * titles, and tapping a day lists its events below the grid.
   */
  compact?: boolean
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// Large (wall-display) cell metrics, in px — used to fit as many events per day
// as the row height allows so the whole month shows without scrolling. Approximate;
// the cell also clips (overflow-hidden), so a miscount never brings a scrollbar back.
const LARGE_HEADER_PX = 44 // date badge + its bottom margin + the cell's top padding
const LARGE_EVENT_PX = 32 // one EventDot row including the list's flex gap

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function timeLabel(occ: OccurrenceOut) {
  if (occ.all_day) return "All day"
  return new Date(occ.start_dt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function MonthView({ year, month, occurrences, onDayClick, onEventClick, onViewDay, large = false, compact = false }: MonthViewProps) {
  const today = toYMD(new Date())
  const [picked, setPicked] = useState<string | null>(null)
  // Phone: the day whose events show under the grid — the tapped day if it's in this
  // month, else today (when in this month), else the 1st.
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`
  const selected =
    picked && picked.startsWith(monthPrefix)
      ? picked
      : today.startsWith(monthPrefix)
        ? today
        : `${monthPrefix}01`

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

  const weeks = cells.length / 7

  // Wall display: the grid fills a fixed height (no scroll), so measure it and
  // derive how many events fit in one day-cell. Six week-rows of a static count
  // overflowed the screen; fitting the count to the measured row height keeps the
  // whole month visible on any kiosk resolution. The phone (`!large`) keeps its
  // static count and scrolls instead.
  const gridRef = useRef<HTMLDivElement>(null)
  const [gridH, setGridH] = useState(0)
  useEffect(() => {
    const el = gridRef.current
    if (!el || !large) return
    const ro = new ResizeObserver(([entry]) => setGridH(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [large])

  const capacity = useMemo(() => {
    if (!large) return 3
    if (!gridH) return 4 // pre-measure default; corrected on the next frame
    const rowH = gridH / weeks
    return Math.max(1, Math.floor((rowH - LARGE_HEADER_PX) / LARGE_EVENT_PX))
  }, [large, gridH, weeks])

  return (
    <div className={cn("flex h-full flex-col", large && "min-h-0")}>
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
      <div
        ref={gridRef}
        className={cn(
          "grid",
          compact ? "auto-rows-[3.75rem]" : "flex-1 auto-rows-fr",
          large && "min-h-0",
        )}
      >
        {Array.from({ length: weeks }, (_, row) => (
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
                      large ? "min-h-0 overflow-hidden" : "min-h-[5rem]",
                      "bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex items-center justify-center font-medium tabular-nums text-muted-foreground/40",
                        large ? "h-9 w-9 text-lg" : "h-6 w-6 text-sm",
                      )}
                    >
                      {date.getDate()}
                    </span>
                  </div>
                )
              }

              const evts = byDay.get(ymd) ?? []
              const isToday = ymd === today

              if (compact) {
                const isSelected = ymd === selected
                return (
                  <button
                    key={col}
                    type="button"
                    aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, ${evts.length} events`}
                    aria-pressed={isSelected}
                    onClick={() => setPicked(ymd)}
                    className={cn(
                      "flex flex-col items-center gap-1 border-r px-0.5 py-1.5 outline-none transition-colors last:border-r-0",
                      isWeekend && !isSelected && "bg-muted/20",
                      isSelected && "bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex size-7 items-center justify-center rounded-full text-sm font-medium tabular-nums",
                        isToday ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground",
                      )}
                    >
                      {date.getDate()}
                    </span>
                    <span className="flex h-2 items-center gap-0.5">
                      {evts.slice(0, 4).map((occ, i) => (
                        <span
                          key={i}
                          className="inline-block size-1.5 rounded-full"
                          style={{ backgroundColor: occ.effective_color }}
                        />
                      ))}
                      {evts.length > 4 && (
                        <span className="text-muted-foreground text-[9px] leading-none">+</span>
                      )}
                    </span>
                  </button>
                )
              }
              // Fit the list to the cell: when it overflows, reserve a slot for the
              // "+N more" line (large only) so the row never exceeds its capacity.
              const overflow = evts.length > capacity
              const shown = overflow
                ? evts.slice(0, large ? Math.max(1, capacity - 1) : capacity)
                : evts
              const hidden = evts.length - shown.length

              return (
                <button
                  key={col}
                  type="button"
                  className={cn(
                    "hover:bg-accent/60 active:bg-accent focus-visible:ring-ring/40 group flex flex-col items-stretch border-r p-1 text-left transition-colors outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset",
                    large ? "min-h-0 overflow-hidden" : "min-h-[5rem]",
                    isWeekend && !isToday && "bg-muted/20",
                  )}
                  onClick={() => onDayClick(ymd)}
                >
                  <span
                    className={cn(
                      "mb-0.5 inline-flex flex-shrink-0 items-center justify-center rounded-full font-medium tabular-nums",
                      large ? "h-8 w-8 text-base" : "h-6 w-6 text-sm",
                      isToday
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-foreground group-hover:bg-background/60",
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <div className={cn("flex min-h-0 flex-col", large ? "gap-1" : "gap-0.5")}>
                    {shown.map((occ, i) => (
                      <div
                        key={i}
                        role="button"
                        tabIndex={-1}
                        className="flex-shrink-0"
                        onClick={(e) => { e.stopPropagation(); onEventClick(occ) }}
                      >
                        <EventDot
                          colors={occ.members.length ? occ.members.map((m) => m.color) : [occ.effective_color]}
                          title={occ.title}
                          large={large}
                        />
                      </div>
                    ))}
                    {hidden > 0 && (
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => { e.stopPropagation(); (onViewDay ?? onDayClick)(ymd) }}
                        className={cn(
                          "text-muted-foreground hover:text-foreground flex-shrink-0 rounded pl-1 font-medium transition-colors",
                          large ? "text-base" : "text-xs",
                        )}
                      >
                        +{hidden} more
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {compact && (
        <section className="flex-1 border-t px-4 py-3" aria-label="Events on the selected day">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </h3>
            <div className="flex items-center gap-1">
              {onViewDay && (
                <Button variant="ghost" size="sm" onClick={() => onViewDay(selected)}>
                  Day view
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => onDayClick(selected)}>
                <PlusIcon className="size-4" />
                Add
              </Button>
            </div>
          </div>
          {(byDay.get(selected) ?? []).length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">Nothing planned.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {(byDay.get(selected) ?? []).map((occ, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onEventClick(occ)}
                    className="hover:bg-accent/60 active:bg-accent flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors"
                  >
                    <span
                      className="h-8 w-1 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: occ.effective_color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{occ.title}</span>
                      <span className="text-muted-foreground block text-xs">{timeLabel(occ)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
