"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import {
  CheckIcon,
  ImageIcon,
  Loader2Icon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { ApiError } from "@/lib/api-client"
import { encodeUpload } from "@/lib/file-to-base64"
import { useExtractEventsFromFlyer } from "@/hooks/use-magic-import"
import { useCreateEvent } from "@/hooks/use-calendars"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { EventDraft, EventExtractionResult } from "@/lib/types/magic-import"

type RowStatus = "idle" | "saving" | "saved" | "error"

interface Row {
  title: string
  location: string
  description: string
  start: string // datetime-local
  end: string
  all_day: boolean
  is_countdown: boolean
  year_inferred: boolean
  time_inferred: boolean
  status: RowStatus
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

function draftToRow(d: EventDraft): Row {
  return {
    title: d.title,
    location: d.location ?? "",
    description: d.description ?? "",
    start: toDatetimeLocal(d.start_dt),
    end: toDatetimeLocal(d.end_dt),
    all_day: d.all_day,
    is_countdown: d.is_countdown,
    year_inferred: d.year_inferred,
    time_inferred: d.time_inferred,
    status: "idle",
  }
}

function aiErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 503) {
    return "AI import isn't set up yet — add a Gemini API key on the server."
  }
  return "Couldn't read that flyer. Please try a clearer photo."
}

export function FlyerImportDialog({
  open,
  onClose,
  familyId,
}: {
  open: boolean
  onClose: () => void
  familyId: string
}) {
  if (!open) return null
  return <ImportFlow familyId={familyId} onClose={onClose} />
}

function ImportFlow({ familyId, onClose }: { familyId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [notes, setNotes] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const extract = useExtractEventsFromFlyer(familyId)
  const createEvent = useCreateEvent(familyId)
  const [saving, setSaving] = useState(false)

  function handleResult(res: EventExtractionResult) {
    setNotes(res.notes)
    if (res.events.length === 0) {
      toast.info(res.notes ?? "No events found — try a clearer photo or add one manually.")
      return
    }
    setRows(res.events.map(draftToRow))
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return
    let encoded
    try {
      encoded = await encodeUpload(file)
    } catch {
      toast.error("Couldn't read that file.")
      return
    }
    extract.mutate(encoded, {
      onSuccess: handleResult,
      onError: (err) => toast.error(aiErrorMessage(err)),
    })
  }

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((rs) => rs && rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  async function saveAll() {
    if (!rows) return
    setSaving(true)
    let saved = 0
    let failed = 0
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.status === "saved" || !row.title.trim()) continue
      updateRow(i, { status: "saving" })
      try {
        await createEvent.mutateAsync({
          title: row.title.trim(),
          location: row.location.trim() || undefined,
          description: row.description.trim() || undefined,
          start_dt: new Date(row.start).toISOString(),
          end_dt: new Date(row.end).toISOString(),
          all_day: row.all_day,
          is_countdown: row.is_countdown,
        })
        updateRow(i, { status: "saved" })
        saved++
      } catch {
        updateRow(i, { status: "error" })
        failed++
      }
    }
    setSaving(false)
    if (saved > 0) toast.success(`Added ${saved} event${saved === 1 ? "" : "s"}`)
    if (failed > 0) toast.error(`${failed} couldn't be saved — review and retry.`)
    else if (saved > 0) onClose()
  }

  // ── Input step ──────────────────────────────────────────────────────────────
  if (!rows) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="gap-0 p-0 sm:max-w-md">
          <DialogHeader className="border-b p-5">
            <DialogTitle className="flex items-center gap-2">
              <SparklesIcon className="size-5" /> Import events from a flyer
            </DialogTitle>
            <DialogDescription>
              Snap a photo or upload a PDF — we&apos;ll pull out the dates for you to review before
              anything is added.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 p-5">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={(e) => onPickFile(e.target.files?.[0])}
            />
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={extract.isPending}
              className="w-full"
            >
              {extract.isPending ? <Loader2Icon className="animate-spin" /> : <ImageIcon />}
              {extract.isPending ? "Reading…" : "Choose a photo or PDF"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ── Review step ───────────────────────────────────────────────────────────────
  const pending = rows.filter((r) => r.status !== "saved" && r.title.trim()).length
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-5">
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5" /> Review events
          </DialogTitle>
          <DialogDescription>
            Check the dates and titles, then add them to the calendar. Highlighted fields were
            guessed — give them a look.
          </DialogDescription>
        </DialogHeader>

        <div className="thin-scrollbar flex-1 overflow-y-auto p-5">
          {notes && (
            <p className="text-muted-foreground mb-3 flex items-center gap-1.5 text-xs">
              <TriangleAlertIcon className="size-3.5 shrink-0" /> {notes}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {rows.map((row, idx) => (
              <li
                key={idx}
                className="ring-foreground/5 flex flex-col gap-2 rounded-2xl p-3 shadow-sm ring-1"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={row.title}
                    onChange={(e) => updateRow(idx, { title: e.target.value })}
                    placeholder="Event title"
                    aria-label="Event title"
                    className="flex-1"
                  />
                  {row.status === "saved" ? (
                    <CheckIcon className="size-5 shrink-0 text-green-600" aria-label="Saved" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove event"
                      onClick={() => setRows((rs) => rs && rs.filter((_, i) => i !== idx))}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                    >
                      <XIcon />
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={row.start}
                    onChange={(e) => updateRow(idx, { start: e.target.value })}
                    aria-label="Start"
                    className="w-auto flex-1"
                  />
                  <span className="text-muted-foreground text-xs">to</span>
                  <Input
                    type="datetime-local"
                    value={row.end}
                    onChange={(e) => updateRow(idx, { end: e.target.value })}
                    aria-label="End"
                    className="w-auto flex-1"
                  />
                </div>

                <Input
                  value={row.location}
                  onChange={(e) => updateRow(idx, { location: e.target.value })}
                  placeholder="Location"
                  aria-label="Location"
                />
                <Textarea
                  value={row.description}
                  onChange={(e) => updateRow(idx, { description: e.target.value })}
                  placeholder="Notes / details"
                  aria-label="Description"
                  className="min-h-0 resize-none"
                  rows={2}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={row.all_day}
                      onChange={(e) => updateRow(idx, { all_day: e.target.checked })}
                    />
                    All day
                  </label>
                  {row.year_inferred && (
                    <Badge variant="secondary" className="text-[10px]">
                      year guessed
                    </Badge>
                  )}
                  {row.time_inferred && (
                    <Badge variant="secondary" className="text-[10px]">
                      time guessed
                    </Badge>
                  )}
                  {row.status === "error" && (
                    <Badge variant="destructive" className="text-[10px]">
                      failed — retry
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="gap-2 border-t p-5">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            {rows.some((r) => r.status === "saved") ? "Done" : "Cancel"}
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={saveAll}
            disabled={saving || pending === 0}
          >
            {saving ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
            {pending > 0 ? `Add ${pending} event${pending === 1 ? "" : "s"}` : "All added"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
