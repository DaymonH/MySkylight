"use client"

import { toast } from "sonner"
import {
  CalendarDaysIcon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  useDisconnectExternalAccount,
  useMapExternalCalendar,
  useSyncExternalAccount,
} from "@/hooks/use-external-calendars"
import { ApiError } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { CalendarOut } from "@/lib/types/calendar"
import type {
  ExternalAccountOut,
  ExternalCalendarOut,
} from "@/lib/types/external"

// Select sentinels — Radix Select can't use "" as a value, so map the
// "not mapped" / "create a new local calendar" choices to explicit tokens.
const NONE = "__none__"
const CREATE = "__create__"

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google Calendar",
  apple: "Apple iCloud",
}

function formatWhen(iso: string | null): string {
  if (!iso) return "Never synced"
  return `Synced ${new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`
}

export function ExternalAccountCard({
  familyId,
  account,
  calendars,
}: {
  familyId: string
  account: ExternalAccountOut
  calendars: CalendarOut[]
}) {
  const syncAccount = useSyncExternalAccount(familyId)
  const disconnect = useDisconnectExternalAccount(familyId)
  const mapCalendar = useMapExternalCalendar(familyId)

  const needsReauth = account.status === "needs_reauth"

  function handleSync() {
    syncAccount.mutate(account.id, {
      onSuccess: (res) => {
        const changed = res.created + res.updated + res.deleted
        toast.success(
          changed === 0
            ? "Already up to date"
            : `Synced ${res.calendars_synced} calendar${
                res.calendars_synced === 1 ? "" : "s"
              } · ${res.created} new, ${res.updated} updated, ${res.deleted} removed`,
        )
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) {
          toast.error("This account needs to be reconnected.")
        } else {
          toast.error("Sync failed. Please try again.")
        }
      },
    })
  }

  function handleDisconnect() {
    disconnect.mutate(account.id, {
      onSuccess: () => toast.success("Account disconnected"),
      onError: () => toast.error("Couldn't disconnect. Please try again."),
    })
  }

  function handleMap(cal: ExternalCalendarOut, value: string) {
    const args =
      value === NONE
        ? { extCalId: cal.id, calendarId: null }
        : value === CREATE
          ? { extCalId: cal.id, create: true }
          : { extCalId: cal.id, calendarId: value }
    mapCalendar.mutate(args, {
      onSuccess: () => {
        if (value === NONE) toast.success(`Stopped syncing “${cal.name}”`)
        else toast.success(`“${cal.name}” will sync into your calendar`)
      },
      onError: () => toast.error("Couldn't update that calendar. Please try again."),
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-muted text-muted-foreground flex size-10 flex-shrink-0 items-center justify-center rounded-2xl">
            <CalendarDaysIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-medium leading-tight">
              {PROVIDER_LABEL[account.provider] ?? account.provider}
            </p>
            <p className="text-muted-foreground truncate text-sm">
              {account.account_email ?? "Connected account"}
            </p>
          </div>
        </div>
        <Badge variant={needsReauth ? "destructive" : "secondary"} className="flex-shrink-0">
          {needsReauth ? (
            <>
              <TriangleAlertIcon className="size-3" /> Reconnect needed
            </>
          ) : (
            "Connected"
          )}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {needsReauth && (
          <p className="text-muted-foreground bg-muted/50 rounded-2xl px-3.5 py-2.5 text-sm">
            Access expired or was revoked. Reconnect this account above to resume
            syncing.
          </p>
        )}

        <div className="flex flex-col gap-2.5">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Calendars
          </p>
          {account.calendars.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No calendars were found on this account.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {account.calendars.map((cal) => {
                const value = cal.calendar_id ?? NONE
                const isPending =
                  mapCalendar.isPending && mapCalendar.variables?.extCalId === cal.id
                return (
                  <li
                    key={cal.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-3 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: cal.color ?? "#94a3b8" }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{cal.name}</p>
                        {cal.calendar_id && (
                          <p className="text-muted-foreground text-xs">
                            {formatWhen(cal.last_synced_at)}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isPending && (
                        <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
                      )}
                      <Select
                        value={value}
                        onValueChange={(v) => handleMap(cal, v)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="w-full sm:w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Don&apos;t sync</SelectItem>
                          <SelectItem value={CREATE}>＋ New calendar</SelectItem>
                          {calendars.length > 0 && <SelectSeparator />}
                          {calendars.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncAccount.isPending}
          >
            {syncAccount.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
            Sync now
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2Icon /> Disconnect
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect this account?</AlertDialogTitle>
                <AlertDialogDescription>
                  New events will stop syncing. Events already pulled in stay on
                  your calendar. You can reconnect anytime.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={disconnect.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleDisconnect}
                  disabled={disconnect.isPending}
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}
