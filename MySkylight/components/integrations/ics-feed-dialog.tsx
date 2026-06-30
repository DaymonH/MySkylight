"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2Icon, SparklesIcon } from "lucide-react"

import { useConnectIcsFeed } from "@/hooks/use-external-calendars"
import { ApiError } from "@/lib/api-client"
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
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
})
type FormValues = z.infer<typeof schema>

const DEFAULTS: FormValues = { url: "", name: "", color: "#d93025" }

export function IcsFeedDialog({
  familyId,
  open,
  onOpenChange,
}: {
  familyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const connect = useConnectIcsFeed(familyId)
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS })

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

          <div className="flex items-end gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="feed_name">Name (optional)</Label>
              <Input
                id="feed_name"
                placeholder="e.g. US Holidays"
                {...register("name")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feed_color">Colour</Label>
              <Input
                id="feed_color"
                type="color"
                className="h-9 w-14 p-1"
                {...register("color")}
              />
            </div>
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
