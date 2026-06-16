"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"
import {
  DownloadIcon,
  FileUpIcon,
  LinkIcon,
  Loader2Icon,
  UploadIcon,
} from "lucide-react"

import { useImportCalendarIcs } from "@/hooks/use-calendars"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CalendarOut } from "@/lib/types/calendar"

type ImportSource = "file" | "paste" | "url"

/** A filesystem-safe-ish basename for the downloaded `.ics`, e.g. "Family" -> "family". */
function icsFilename(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return `${slug || "calendar"}.ics`
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

/**
 * Import / export a calendar as `.ics` (F25). Export streams through the same
 * auth proxy the rest of the app uses (the `GET …/ics` route returns
 * `text/calendar`, which our JSON `apiRequest` helper drops — so fetch the raw
 * text here and hand the browser a Blob). Import accepts an uploaded file,
 * pasted text, or a feed URL the backend fetches itself.
 */
export function CalendarSyncDialog({
  open,
  onClose,
  familyId,
  calendars,
}: {
  open: boolean
  onClose: () => void
  familyId: string
  calendars: CalendarOut[]
}) {
  const importIcs = useImportCalendarIcs(familyId)

  const [calendarId, setCalendarId] = useState("")
  const [source, setSource] = useState<ImportSource>("file")
  const [icsText, setIcsText] = useState("")
  const [fileName, setFileName] = useState("")
  const [url, setUrl] = useState("")
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Default to the first calendar and stay valid if calendars change, without an
  // effect: derive the effective id at render rather than syncing it into state.
  const effectiveCalendarId =
    calendars.find((c) => c.id === calendarId)?.id ?? calendars[0]?.id ?? ""
  const selected = calendars.find((c) => c.id === effectiveCalendarId)

  // Reset the import form whenever the dialog is dismissed (an event handler, not
  // an effect — keeps each open starting clean without cascading renders).
  function resetAndClose() {
    setSource("file")
    setIcsText("")
    setFileName("")
    setUrl("")
    onClose()
  }

  async function handleExport() {
    if (!effectiveCalendarId) return
    setExporting(true)
    try {
      const res = await fetch(
        `/api/backend/api/v1/families/${familyId}/calendars/${effectiveCalendarId}/ics`,
      )
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const text = await res.text()
      const blob = new Blob([text], { type: "text/calendar" })
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = href
      a.download = icsFilename(selected?.name ?? "calendar")
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
      toast.success("Calendar exported")
    } catch {
      toast.error("Couldn't export the calendar. Please try again.")
    } finally {
      setExporting(false)
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    if (!file) return
    try {
      setIcsText(await readFileAsText(file))
      setFileName(file.name)
    } catch {
      toast.error("Couldn't read that file.")
    }
  }

  const importPayload =
    source === "url"
      ? url.trim()
        ? { url: url.trim() }
        : null
      : icsText.trim()
        ? { ics: icsText }
        : null

  async function handleImport() {
    if (!effectiveCalendarId || !importPayload) return
    try {
      const result = await importIcs.mutateAsync({
        calendarId: effectiveCalendarId,
        ...importPayload,
      })
      if (result.total === 0) {
        toast.info("No events found to import.")
      } else {
        toast.success(
          `Imported ${result.total} event${result.total === 1 ? "" : "s"}` +
            ` (${result.created} new, ${result.updated} updated)`,
        )
      }
      resetAndClose()
    } catch {
      toast.error("Import failed. Check the file or URL and try again.")
    }
  }

  const SOURCES: { value: ImportSource; label: string }[] = [
    { value: "file", label: "Upload" },
    { value: "paste", label: "Paste" },
    { value: "url", label: "URL" },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && resetAndClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import / export calendar</DialogTitle>
          <DialogDescription>
            Move events in or out as a standard <code>.ics</code> file.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="sync-calendar">Calendar</Label>
          <Select value={effectiveCalendarId} onValueChange={setCalendarId}>
            <SelectTrigger id="sync-calendar" className="w-full">
              <SelectValue placeholder="Choose a calendar" />
            </SelectTrigger>
            <SelectContent>
              {calendars.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Export */}
        <div className="flex flex-col gap-2 rounded-3xl bg-muted/40 p-4">
          <p className="text-sm font-medium">Export</p>
          <p className="text-sm text-muted-foreground">
            Download every event in this calendar as an <code>.ics</code> file —
            recurring events and all-day events included.
          </p>
          <Button
            variant="outline"
            className="w-fit"
            onClick={handleExport}
            disabled={!effectiveCalendarId || exporting}
          >
            {exporting ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <DownloadIcon />
            )}
            Download .ics
          </Button>
        </div>

        {/* Import */}
        <div className="flex flex-col gap-3 rounded-3xl bg-muted/40 p-4">
          <p className="text-sm font-medium">Import</p>
          <ToggleGroup
            type="single"
            spacing={0}
            variant="outline"
            value={source}
            onValueChange={(v) => v && setSource(v as ImportSource)}
            className="w-full"
          >
            {SOURCES.map((s) => (
              <ToggleGroupItem key={s.value} value={s.value} className="flex-1">
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {source === "file" && (
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".ics,text/calendar"
                className="hidden"
                onChange={handleFile}
              />
              <Button
                variant="secondary"
                className="w-fit"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUpIcon />
                Choose file
              </Button>
              {fileName && (
                <p className="truncate text-sm text-muted-foreground">{fileName}</p>
              )}
            </div>
          )}

          {source === "paste" && (
            <Textarea
              value={icsText}
              onChange={(e) => setIcsText(e.target.value)}
              placeholder="BEGIN:VCALENDAR…"
              className="h-28 font-mono text-xs"
            />
          )}

          {source === "url" && (
            <div className="relative">
              <LinkIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/calendar.ics"
                className="pl-9"
              />
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Events re-imported from the same source update in place instead of
            duplicating.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!effectiveCalendarId || !importPayload || importIcs.isPending}
          >
            {importIcs.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <UploadIcon />
            )}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
