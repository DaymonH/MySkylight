"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { SettingsIcon } from "lucide-react"
import { UserButton } from "@clerk/nextjs"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useVisibleHours } from "@/hooks/use-visible-hours"
import { PALETTES, usePalette } from "@/hooks/use-palette"
import { cn } from "@/lib/utils"

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const

function fmtHour(h: number) {
  if (h === 0) return "12 AM"
  if (h === 12) return "12 PM"
  if (h === 24) return "12 AM (next day)"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

const START_HOURS = Array.from({ length: 24 }, (_, i) => i) // 0..23
const END_HOURS = Array.from({ length: 24 }, (_, i) => i + 1) // 1..24

export function SettingsButton({
  className,
  label,
}: {
  className?: string
  /** When set, renders a stacked icon-over-label rail item (for the device sidebar). */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const { theme, setTheme } = useTheme()
  const { palette, setPalette } = usePalette()
  const { start, end, setRange } = useVisibleHours()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {label ? (
          <button type="button" className={cn(className)} aria-label="Open settings">
            <SettingsIcon className="size-6" />
            {label}
          </button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className={className}
            aria-label="Open settings"
          >
            <SettingsIcon />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Personalize how MySkylight looks and behaves.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          {/* Account — the Clerk user menu (manage account / sign out) */}
          <section className="grid gap-3">
            <h3 className="text-sm font-medium">Account</h3>
            <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2.5">
              <span className="text-sm text-muted-foreground">
                Manage your account or sign out
              </span>
              <UserButton appearance={{ elements: { avatarBox: "size-8" } }} />
            </div>
          </section>

          {/* Appearance — light / dark / system */}
          <section className="grid gap-3">
            <h3 className="text-sm font-medium">Appearance</h3>
            <RadioGroup
              value={theme ?? "system"}
              onValueChange={setTheme}
              className="grid grid-cols-3 gap-2"
            >
              {THEME_OPTIONS.map((opt) => (
                <Label
                  key={opt.value}
                  htmlFor={`theme-${opt.value}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem id={`theme-${opt.value}`} value={opt.value} />
                  <span>{opt.label}</span>
                </Label>
              ))}
            </RadioGroup>
          </section>

          {/* Color theme — palette applied to both light and dark */}
          <section className="grid gap-3">
            <div>
              <h3 className="text-sm font-medium">Color theme</h3>
              <p className="text-xs text-muted-foreground">
                Applies to both light and dark.
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Color theme"
              className="grid grid-cols-2 gap-2"
            >
              {PALETTES.map((p) => {
                const active = palette === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPalette(p.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border bg-background p-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
                      active
                        ? "border-primary ring-2 ring-primary/30"
                        : "hover:bg-muted",
                    )}
                  >
                    <span className="relative size-8 shrink-0 overflow-hidden rounded-full border">
                      <span
                        className="absolute inset-0"
                        style={{ background: p.swatch.light }}
                      />
                      <span
                        className="absolute inset-y-0 right-0 w-1/2"
                        style={{ background: p.swatch.dark }}
                      />
                      <span
                        className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/15"
                        style={{ background: p.swatch.accent }}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-tight">
                        {p.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.hint}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Visible hours (week / day views) */}
          <section className="grid gap-3">
            <div>
              <h3 className="text-sm font-medium">Calendar hours</h3>
              <p className="text-xs text-muted-foreground">
                Time range shown on the week and day views.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label
                  htmlFor="hours-start"
                  className="text-xs text-muted-foreground"
                >
                  Start
                </Label>
                <Select
                  value={String(start)}
                  onValueChange={(v) => {
                    const s = Number.parseInt(v, 10)
                    setRange(s, end <= s ? s + 1 : end)
                  }}
                >
                  <SelectTrigger id="hours-start" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {START_HOURS.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {fmtHour(h)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label
                  htmlFor="hours-end"
                  className="text-xs text-muted-foreground"
                >
                  End
                </Label>
                <Select
                  value={String(end)}
                  onValueChange={(v) => setRange(start, Number.parseInt(v, 10))}
                >
                  <SelectTrigger id="hours-end" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {END_HOURS.filter((h) => h > start).map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {fmtHour(h)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
