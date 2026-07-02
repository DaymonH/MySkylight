"use client"

import { CheckIcon } from "lucide-react"

import { CALENDAR_COLORS, readableTextOn } from "@/lib/colors"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Tap-a-dot color picker for a mirrored calendar's tint. Offers a fixed preset
 * palette (no free-form hex). Colors already used by another synced calendar are
 * flagged with a dot so the user picks knowingly — duplicates are allowed, not
 * blocked. `usage` maps a lowercased `#rrggbb` to the names of the *other*
 * calendars using it; `onSelect` fires with the chosen preset.
 */
export function CalendarColorPicker({
  value,
  onSelect,
  label,
  usage = {},
  disabled,
}: {
  value: string | null
  onSelect: (color: string) => void
  label: string
  usage?: Record<string, string[]>
  disabled?: boolean
}) {
  const current = value && HEX.test(value) ? value : null
  const anyInUse = Object.values(usage).some((names) => names.length > 0)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Change color for ${label}`}
          className="hover:bg-muted focus-visible:ring-ring flex size-7 flex-shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          <span
            className="size-3.5 rounded-full ring-1 ring-foreground/15"
            style={{ backgroundColor: current ?? "#94a3b8" }}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-auto min-w-0 p-2">
        <DropdownMenuLabel className="px-1 pt-0 pb-1.5">
          Event color
        </DropdownMenuLabel>
        <div className="grid grid-cols-4 gap-1.5">
          {CALENDAR_COLORS.map((c) => {
            const key = c.toLowerCase()
            const selected = current?.toLowerCase() === key
            const usedBy = usage[key] ?? []
            const inUse = usedBy.length > 0
            return (
              <DropdownMenuItem
                key={c}
                onSelect={() => onSelect(c)}
                title={inUse ? `Also used by ${usedBy.join(", ")}` : undefined}
                aria-label={
                  inUse
                    ? `Color ${c} — also used by ${usedBy.join(", ")}`
                    : `Color ${c}`
                }
                className={cn(
                  "relative size-9 justify-center rounded-full p-0 ring-1 ring-foreground/10",
                  selected &&
                    "ring-foreground ring-2 ring-offset-2 ring-offset-popover",
                )}
                style={{ backgroundColor: c }}
              >
                {selected && (
                  <CheckIcon
                    className="size-4"
                    style={{ color: readableTextOn(c) }}
                  />
                )}
                {inUse && !selected && (
                  <span
                    aria-hidden
                    className="border-popover bg-foreground/70 absolute top-0 right-0 size-2.5 rounded-full border-2"
                  />
                )}
              </DropdownMenuItem>
            )
          })}
        </div>
        {anyInUse && (
          <p className="text-muted-foreground mt-2 flex items-center gap-1.5 px-1 text-xs leading-snug">
            <span
              aria-hidden
              className="border-popover bg-foreground/70 inline-block size-2.5 flex-shrink-0 rounded-full border-2"
            />
            Used by another calendar
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
