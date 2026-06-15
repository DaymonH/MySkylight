"use client"

import { cn } from "@/lib/utils"
import type { OccurrenceOut } from "@/lib/types/calendar"

interface CountdownStripProps {
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
  large?: boolean
  /** Extra classes from the caller (borders/flex when sharing a band). */
  className?: string
}

export function CountdownStrip({
  occurrences,
  onEventClick,
  large = false,
  className,
}: CountdownStripProps) {
  // The strip is fed a forward window (up to a year), so a recurring countdown
  // expands into many occurrences — collapse to the nearest one per event.
  const seen = new Set<string>()
  const countdowns = occurrences
    .filter((o) => o.is_countdown && o.days_until !== null && o.days_until >= 0)
    .sort((a, b) => (a.days_until ?? 0) - (b.days_until ?? 0))
    .filter((o) => {
      if (seen.has(o.event_id)) return false
      seen.add(o.event_id)
      return true
    })
    .slice(0, 8)

  if (countdowns.length === 0) return null

  return (
    <div className={cn("px-3", large ? "py-2.5 lg:px-5" : "py-2", className)}>
      <p className="text-muted-foreground mb-1.5 text-[10px] font-medium tracking-wide uppercase">
        Countdowns
      </p>
      <div className="no-scrollbar flex gap-2.5 overflow-x-auto">
        {countdowns.map((occ) => {
          const isToday = occ.days_until === 0
          return (
            <button
              key={occ.event_id}
              onClick={() => onEventClick(occ)}
              aria-label={`${occ.title}, ${
                isToday ? "today" : `in ${occ.days_until} days`
              }`}
              className={cn(
                "bg-card ring-foreground/5 relative flex flex-shrink-0 flex-col items-center gap-0.5 overflow-hidden rounded-xl px-3 text-center shadow-sm ring-1 transition-all hover:-translate-y-0.5 hover:shadow-md",
                large ? "min-w-[5.5rem] py-2" : "min-w-[4.75rem] py-1.5",
              )}
            >
              {/* color accent bar */}
              <span
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: occ.effective_color }}
              />
              <span
                className={cn("font-bold leading-none tabular-nums", large ? "text-2xl" : "text-xl")}
                style={{ color: occ.effective_color }}
              >
                {isToday ? "🎉" : occ.days_until}
              </span>
              {!isToday && (
                <span className={cn("text-muted-foreground", large ? "text-xs" : "text-[10px]")}>
                  {occ.days_until === 1 ? "day" : "days"}
                </span>
              )}
              <span className={cn("mt-0.5 max-w-[7rem] truncate font-medium", large ? "text-xs" : "text-[11px]")}>
                {occ.title}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
