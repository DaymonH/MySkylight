"use client"

import { Layers3Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { CalendarSource } from "@/lib/calendar-sources"

interface CalendarFilterProps {
  sources: CalendarSource[]
  /** Keys the user has hidden. Empty = everything shows. */
  hidden: Set<string>
  onToggle: (key: string) => void
  onShowAll: () => void
  onHideAll: () => void
  /** Device (wall-display) treatment — larger trigger to match the toolbar. */
  large?: boolean
}

const PROVIDER_LABEL: Record<CalendarSource["provider"], string> = {
  google: "Google",
  apple: "Apple",
  ics: "ICS",
  local: "",
}

/**
 * Calendar visibility toggle — a "Calendars" button opening a checklist of every
 * source (native + each synced external calendar), all shown by default.
 * Deselecting one hides its events on every view. Distinct from the integrations
 * "sync" switch: this is a quick, per-device show/hide, not a re-pull.
 */
export function CalendarFilter({
  sources,
  hidden,
  onToggle,
  onShowAll,
  onHideAll,
  large = false,
}: CalendarFilterProps) {
  const shownCount = sources.filter((s) => !hidden.has(s.key)).length
  const someHidden = shownCount < sources.length

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={large ? "lg" : "sm"}>
          <Layers3Icon />
          <span className={large ? "" : "hidden sm:inline"}>Calendars</span>
          {someHidden && (
            <span className="bg-primary/15 text-primary ml-0.5 rounded-full px-1.5 text-xs font-medium tabular-nums">
              {shownCount}/{sources.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Show calendars</DropdownMenuLabel>
        {sources.map((s) => (
          <DropdownMenuCheckboxItem
            key={s.key}
            checked={!hidden.has(s.key)}
            // Keep the menu open so several calendars can be toggled in one pass.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(s.key)}
          >
            <span
              className={cn(
                "ring-foreground/10 size-3 flex-shrink-0 rounded-full ring-1",
                !s.color && "bg-primary",
              )}
              style={s.color ? { backgroundColor: s.color } : undefined}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {s.provider !== "local" && (
              <span className="text-muted-foreground text-xs">
                {PROVIDER_LABEL[s.provider]}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onShowAll()
          }}
        >
          Show all
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onHideAll()
          }}
        >
          Hide all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
