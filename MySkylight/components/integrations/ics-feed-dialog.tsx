"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { CheckIcon, Loader2Icon, SparklesIcon } from "lucide-react"

import { useConnectIcsFeed } from "@/hooks/use-external-calendars"
import { ApiError } from "@/lib/api-client"
import { CALENDAR_COLORS, readableTextOn } from "@/lib/colors"
import { cn } from "@/lib/utils"
import type { CalendarColorRef } from "@/lib/types/external"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// A public, maintained US-Holidays feed — offered as a one-tap fill since it's the
// most common reason to subscribe (and iCloud's CalDAV won't expose the iPhone one).
const US_HOLIDAYS_FEED =
  "https://calendar.google.com/calendar/ical/" +
  "en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics"

const schema = z.object({
  url: z
    .string()
    .min(1, "Enter a calendar feed URL")
    .refine(
      (v) => /^(https?|webcals?):\/\//i.test(v.trim()),
      "Must start with http(s):// or webcal://",
    ),
  name: z.string().max(512).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a color"),
})
type FormValues = z.infer<typeof schema>

// Holidays (the common reason to subscribe) read as red, so default to the
// palette's red rather than an off-palette hex that no swatch would highlight.
const DEFAULTS: FormValues = { url: "", name: "", color: "#ef4444" }

export function IcsFeedDialog({
  familyId,
  open,
  onOpenChange,
  roster = [],
}: {
  familyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** All calendars in the family — so the picker can flag colors already in use. */
  roster?: CalendarColorRef[]
}) {
  const connect = useConnectIcsFeed(familyId)
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS })

  const selectedColor = watch("color")

  // Colors already used by a synced calendar → the names using each (lowercased hex).
  const usage: Record<string, string[]> = {}
  for (const c of roster) {
    if (!c.synced || !c.color) continue
    const key = c.color.toLowerCase()
    ;(usage[key] ??= []).push(c.name)
  }
  const anyInUse = Object.values(usage).some((names) => names.length > 0)

  useEffect(() => {
    if (open) reset(DEFAULTS)
  }, [open, reset])

  function fillHolidays() {
    setValue("url", US_HOLIDAYS_FEED, { shouldValidate: true })
    setValue("name", "US Holidays")
  }

  function onSubmit(values: FormValues) {
    connect.mutate(
      {
        url: values.url.trim(),
        name: values.name?.trim() || undefined,
        color: values.color,
      },
      {
        onSuccess: () => {
          toast.success("Subscribed", {
            description: "Events will appear shortly and stay up to date automatically.",
          })
          onOpenChange(false)
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 502) {
            toast.error("Couldn't fetch that feed. Check the URL and try again.")
          } else if (e instanceof ApiError && e.status === 400) {
            toast.error("That URL isn't a valid iCalendar (.ics) feed.")
          } else {
            toast.error("Couldn't subscribe to that feed. Please try again.")
          }
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subscribe to a calendar feed</DialogTitle>
          <DialogDescription>
            Paste a public iCalendar (<code>.ics</code>) feed URL. It syncs
            read-only and refreshes automatically — including future years.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feed_url">Feed URL</Label>
            <Input
              id="feed_url"
              type="url"
              autoComplete="off"
              placeholder="https://example.com/calendar.ics"
              {...register("url")}
            />
            {errors.url && (
              <p className="text-destructive text-xs">{errors.url.message}</p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground -ml-2 h-7 w-fit"
              onClick={fillHolidays}
            >
              <SparklesIcon className="size-3.5" />
              Use the US Holidays calendar
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feed_name">Name (optional)</Label>
            <Input
              id="feed_name"
              placeholder="e.g. US Holidays"
              {...register("name")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {CALENDAR_COLORS.map((c) => {
                const selected = selectedColor?.toLowerCase() === c.toLowerCase()
                const usedBy = usage[c.toLowerCase()] ?? []
                const inUse = usedBy.length > 0
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={selected}
                    title={inUse ? `Also used by ${usedBy.join(", ")}` : undefined}
                    aria-label={
                      inUse
                        ? `Color ${c} — also used by ${usedBy.join(", ")}`
                        : `Color ${c}`
                    }
                    onClick={() =>
                      setValue("color", c, { shouldValidate: true })
                    }
                    className={cn(
                      "relative flex size-9 items-center justify-center rounded-full ring-1 ring-foreground/10 transition-transform hover:scale-110",
                      selected &&
                        "ring-foreground ring-2 ring-offset-2 ring-offset-background",
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
                        className="border-background bg-foreground/70 absolute top-0 right-0 size-2.5 rounded-full border-2"
                      />
                    )}
                  </button>
                )
              })}
            </div>
            {anyInUse && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className="border-background bg-foreground/70 inline-block size-2.5 flex-shrink-0 rounded-full border-2"
                />
                Used by another calendar
              </p>
            )}
            <input type="hidden" {...register("color")} />
            {errors.color && (
              <p className="text-destructive text-xs">{errors.color.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={connect.isPending}>
              {connect.isPending && <Loader2Icon className="animate-spin" />}
              Subscribe
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
