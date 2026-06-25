"use client"

import { ChevronDownIcon, FilterXIcon } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  type ChoreFilters,
  type CompletionStatus,
  DEFAULT_FILTERS,
  filtersActive,
} from "@/lib/chores"
import { FREQUENCY_FILTER_OPTIONS, type ChoreFrequency } from "@/lib/recurrence"

interface MemberOption {
  id: string
  name: string
  color: string
}

/**
 * The shared chore filter bar (used by both the device kiosk and the companion
 * app): completion status + by-member + by-routine + by-frequency. Each axis
 * defaults to "all" (modelled as `null` on the filter); toggling items off
 * narrows it, and unchecking back to the full set returns to `null`.
 */
export function ChoreFilterBar({
  filters,
  onChange,
  members,
  routines,
  className,
}: {
  filters: ChoreFilters
  onChange: (next: ChoreFilters) => void
  members: MemberOption[]
  routines: { id: string; name: string }[]
  className?: string
}) {
  // Routine keys include `null` for ungrouped ("Anytime") chores.
  const routineKeys: (string | null)[] = [...routines.map((r) => r.id), null]

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={filters.status}
        // Radix clears the value when you re-press the active item; coerce back to "all".
        onValueChange={(v) =>
          onChange({ ...filters, status: (v || "all") as CompletionStatus })
        }
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="todo">To do</ToggleGroupItem>
        <ToggleGroupItem value="done">Done</ToggleGroupItem>
      </ToggleGroup>

      <MultiSelect
        label="People"
        allLabel="Everyone"
        options={members.map((m) => ({ key: m.id, label: m.name, color: m.color }))}
        selected={filters.memberIds}
        onChange={(memberIds) => onChange({ ...filters, memberIds })}
      />

      <MultiSelect
        label="Routine"
        allLabel="All routines"
        options={routineKeys.map((k) => ({
          key: k,
          label: k === null ? "Anytime" : (routines.find((r) => r.id === k)?.name ?? "Routine"),
        }))}
        selected={filters.routineIds}
        onChange={(routineIds) => onChange({ ...filters, routineIds })}
      />

      <MultiSelect
        label="Repeat"
        allLabel="Any frequency"
        options={FREQUENCY_FILTER_OPTIONS.map((f) => ({ key: f.value, label: f.label }))}
        selected={filters.frequencies}
        onChange={(frequencies) =>
          onChange({ ...filters, frequencies: frequencies as ChoreFrequency[] | null })
        }
      />

      {filtersActive(filters) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-muted-foreground"
        >
          <FilterXIcon /> Clear
        </Button>
      )}
    </div>
  )
}

interface Option<K> {
  key: K
  label: string
  color?: string
}

/**
 * A checkbox dropdown over a fixed option set. `selected === null` means "all"
 * (every box checked); unchecking narrows to an explicit subset, and re-checking
 * the full set collapses back to `null` so the filter reads as inactive.
 */
function MultiSelect<K extends string | null>({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string
  allLabel: string
  options: Option<K>[]
  selected: K[] | null
  onChange: (next: K[] | null) => void
}) {
  const allKeys = options.map((o) => o.key)
  const current = selected ?? allKeys
  const isAll = selected === null

  function toggle(key: K) {
    const has = current.includes(key)
    const next = has ? current.filter((k) => k !== key) : [...current, key]
    // Back to the full set → represent as "all" (null) so the bar reads inactive.
    if (next.length === allKeys.length) onChange(null)
    else onChange(next)
  }

  const triggerLabel = isAll
    ? allLabel
    : current.length === 0
      ? `No ${label.toLowerCase()}`
      : current.length === 1
        ? (options.find((o) => o.key === current[0])?.label ?? `1 ${label}`)
        : `${current.length} selected`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn(!isAll && "border-primary text-primary")}>
          {triggerLabel}
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={String(o.key)}
            checked={current.includes(o.key)}
            // Keep the menu open across multiple toggles.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(o.key)}
          >
            {o.color && (
              <span
                className="mr-1 size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: o.color }}
              />
            )}
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
