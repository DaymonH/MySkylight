"use client"

import { cn } from "@/lib/utils"
import type { OccurrenceOut } from "@/lib/types/calendar"

interface CountdownStripProps {
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
  large?: boolean
}

export function CountdownStrip({ occurrences, onEventClick, large = false }: CountdownStripProps) {
  const countdowns = occurrences
    .filter((o) => o.is_countdown && o.days_until !== null && o.days_until >= 0)
    .sort((a, b) => (a.days_until ?? 0) - (b.days_until ?? 0))
    .slice(0, 8)

  if (countdowns.length === 0) return null

  return (
    <div className={cn("border-b px-3", large ? "py-3 lg:px-5" : "py-2.5")}>
      <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        Countdowns
      </p>
      <div className="no-scrollbar flex gap-2.5 overflow-x-auto">
        {countdowns.map((occ, i) => {
          const isToday = occ.days_until === 0
          return (
            <button
              key={i}
              onClick={() => onEventClick(occ)}
              className={cn(
                "bg-card ring-foreground/5 relative flex flex-shrink-0 flex-col items-center gap-0.5 overflow-hidden rounded-2xl px-4 text-center shadow-sm ring-1 transition-all hover:-translate-y-0.5 hover:shadow-md",
                large ? "min-w-[7rem] py-3" : "min-w-[5.5rem] py-2.5",
              )}
            >
              {/* color accent bar */}
              <span
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: occ.effective_color }}
              />
              <span
                className={cn("font-bold leading-none tabular-nums", large ? "text-4xl" : "text-2xl")}
                style={{ color: occ.effective_color }}
              >
                {isToday ? "🎉" : occ.days_until}
              </span>
              {!isToday && (
                <span className={cn("text-muted-foreground", large ? "text-sm" : "text-xs")}>
                  {occ.days_until === 1 ? "day" : "days"}
                </span>
              )}
              <span className={cn("mt-0.5 max-w-[8rem] truncate font-medium", large ? "text-sm" : "text-xs")}>
                {occ.title}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
