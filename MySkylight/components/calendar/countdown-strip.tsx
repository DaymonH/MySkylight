"use client"

import type { OccurrenceOut } from "@/lib/types/calendar"

interface CountdownStripProps {
  occurrences: OccurrenceOut[]
  onEventClick: (occ: OccurrenceOut) => void
}

export function CountdownStrip({ occurrences, onEventClick }: CountdownStripProps) {
  const countdowns = occurrences
    .filter((o) => o.is_countdown && o.days_until !== null && o.days_until >= 0)
    .sort((a, b) => (a.days_until ?? 0) - (b.days_until ?? 0))
    .slice(0, 6)

  if (countdowns.length === 0) return null

  return (
    <div className="border-b px-3 py-2">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Countdowns</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {countdowns.map((occ, i) => (
          <button
            key={i}
            onClick={() => onEventClick(occ)}
            className="flex flex-shrink-0 flex-col items-center rounded-xl border px-4 py-2 text-center hover:bg-accent"
            style={{ borderColor: occ.effective_color + "66" }}
          >
            <span
              className="text-2xl font-bold tabular-nums leading-none"
              style={{ color: occ.effective_color }}
            >
              {occ.days_until === 0 ? "🎉" : occ.days_until}
            </span>
            {occ.days_until !== 0 && (
              <span className="mt-0.5 text-xs text-muted-foreground">
                {occ.days_until === 1 ? "day" : "days"}
              </span>
            )}
            <span className="mt-1 max-w-[7rem] truncate text-xs font-medium">{occ.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
