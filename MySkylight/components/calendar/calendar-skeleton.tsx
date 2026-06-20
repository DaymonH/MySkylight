import { Skeleton } from "@/components/ui/skeleton"
import type { CalendarView } from "@/lib/types/calendar"

interface CalendarSkeletonProps {
  view: CalendarView
}

export function CalendarSkeleton({ view }: CalendarSkeletonProps) {
  if (view === "month") {
    // Mirror the real month grid (bordered cells, not gaps) so there's no layout
    // shift when data arrives.
    return (
      <div className="flex h-full flex-col">
        <div className="grid grid-cols-7 border-b">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex justify-center py-1.5">
              <Skeleton className="h-3 w-7 rounded" />
            </div>
          ))}
        </div>
        <div className="grid flex-1 auto-rows-fr">
          {Array.from({ length: 5 }, (_, row) => (
            <div key={row} className="grid grid-cols-7 border-b last:border-b-0">
              {Array.from({ length: 7 }, (_, col) => {
                const i = row * 7 + col
                return (
                  <div key={col} className="flex flex-col gap-1.5 border-r p-1.5 last:border-r-0">
                    <Skeleton className="size-6 rounded-full" />
                    {i % 3 === 0 && <Skeleton className="h-3 w-full rounded" />}
                    {i % 4 === 0 && <Skeleton className="h-3 w-2/3 rounded" />}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (view === "schedule") {
    return (
      <div className="flex flex-col gap-4 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-4 w-24 rounded" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-12 w-full rounded-2xl" />
              {i % 2 === 0 && <Skeleton className="h-12 w-full rounded-2xl" />}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // week / day — a column of hour rows
  return (
    <div className="flex flex-col gap-px p-3">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex items-start gap-3 py-2">
          <Skeleton className="h-3 w-10 rounded" />
          <Skeleton className="h-10 flex-1 rounded-xl" style={{ opacity: i % 3 === 0 ? 1 : 0.4 }} />
        </div>
      ))}
    </div>
  )
}
