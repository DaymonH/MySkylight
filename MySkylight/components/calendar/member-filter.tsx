"use client"

import type { CSSProperties } from "react"
import { UsersIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { MemberBrief } from "@/lib/types/calendar"

interface MemberFilterProps {
  members: MemberBrief[]
  /** Currently-focused member, or `null` for "Everyone". */
  activeMemberId: string | null
  onSelect: (memberId: string | null) => void
  /** Device (wall-display) treatment — larger avatars. */
  large?: boolean
  /** Extra classes from the caller (borders/flex when sharing a band). */
  className?: string
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

/**
 * The calendar "profile switcher": a row of member avatars that filters the
 * calendar to one person. Tapping the active member (or "All") clears the filter.
 * Shared by `/device` and `/app` via `CalendarView`.
 */
export function MemberFilter({
  members,
  activeMemberId,
  onSelect,
  large = false,
  className,
}: MemberFilterProps) {
  if (members.length === 0) return null

  const avatarSize = large ? "size-11 text-base" : "size-9 text-xs"
  const labelSize = large ? "text-xs" : "text-[10px]"

  return (
    <div
      className={cn(
        "thin-scrollbar flex items-center gap-2 overflow-x-auto px-3 py-2",
        large && "gap-3 px-5 py-2.5",
        className,
      )}
      role="group"
      aria-label="Filter calendar by member"
    >
      {/* Everyone */}
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={activeMemberId === null}
        className="group flex flex-shrink-0 flex-col items-center gap-1 focus-visible:outline-none"
      >
        <span
          className={cn(
            "bg-muted text-muted-foreground ring-offset-background flex items-center justify-center rounded-full font-medium transition group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2",
            avatarSize,
            activeMemberId === null
              ? "ring-primary ring-2 ring-offset-2"
              : "opacity-60 hover:opacity-100",
          )}
        >
          <UsersIcon className={large ? "size-5" : "size-4"} />
        </span>
        <span className={cn("text-muted-foreground max-w-16 truncate", labelSize)}>All</span>
      </button>

      {members.map((m) => {
        const active = m.id === activeMemberId
        // Tint the active ring to the member's own colour.
        const style: CSSProperties = { backgroundColor: m.color }
        if (active) (style as Record<string, string>)["--tw-ring-color"] = m.color

        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(active ? null : m.id)}
            aria-pressed={active}
            title={m.name}
            className="group flex flex-shrink-0 flex-col items-center gap-1 focus-visible:outline-none"
          >
            <span
              className={cn(
                "ring-offset-background flex items-center justify-center rounded-full font-semibold text-white transition group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2",
                avatarSize,
                active ? "ring-2 ring-offset-2" : "opacity-60 hover:opacity-100",
              )}
              style={style}
            >
              {initials(m.name)}
            </span>
            <span
              className={cn(
                "max-w-16 truncate",
                labelSize,
                active ? "font-medium" : "text-muted-foreground",
              )}
            >
              {m.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
