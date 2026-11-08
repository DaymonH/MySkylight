"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  CalendarDaysIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from "lucide-react"

import {
  useCleanupDuplicateEvents,
  useDeleteSubscribedFeed,
  useDisconnectExternalAccount,
  useSetCalendarColor,
  useSetCalendarSync,
  useSyncExternalAccount,
} from "@/hooks/use-external-calendars"
import { ApiError } from "@/lib/api-client"
import { CalendarColorPicker } from "@/components/integrations/calendar-color-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  CalendarColorRef,
  ExternalAccountOut,
  ExternalCalendarOut,
} from "@/lib/types/external"

/** Join names for a sentence: ["A"] → "A", ["A","B"] → "A and B", 3+ → "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google Calendar",
  apple: "Apple iCloud",
  ics: "Subscribed feeds",
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
  roster,
}: {
  familyId: string
  account: ExternalAccountOut
  /** All calendars in the family (every account) — so the color picker can flag
   *  which presets another calendar is already using. */
  roster: CalendarColorRef[]
}) {
  const syncAccount = useSyncExternalAccount(familyId)
  const cleanupDuplicates = useCleanupDuplicateEvents(familyId)
  const disconnect = useDisconnectExternalAccount(familyId)
  const deleteFeed = useDeleteSubscribedFeed(familyId)
  const setSync = useSetCalendarSync(familyId)
  const setColor = useSetCalendarColor(familyId)

  // Disconnect confirmation is a *controlled* AlertDialog rendered outside the
  // dropdown. If it lived inside a DropdownMenuItem, the menu closing would
  // unmount it and it would flash shut, so we open it via state instead.
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  // Subscribed feeds can each be deleted outright (a sync switch only hides one).
  const isFeeds = account.provider === "ics"
  const [feedToDelete, setFeedToDelete] = useState<ExternalCalendarOut | null>(null)

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
        } else if (e instanceof ApiError && e.message) {
          // Surface the backend's reason (e.g. unreachable provider, not
          // configured) instead of a vague catch-all, so failures are debuggable.
          toast.error("Sync failed", { description: e.message })
        } else {
          toast.error("Sync failed. Please try again.")
        }
      },
    })
  }

  function handleCleanup() {
    cleanupDuplicates.mutate(undefined, {
      onSuccess: (res) =>
        res.removed === 0
          ? toast.success("No leftover duplicates found")
          : toast.success(
              `Removed ${res.removed} duplicate event${res.removed === 1 ? "" : "s"}`,
              { description: "Your calendar will refresh in a moment." },
            ),
      onError: (e) => {
        if (e instanceof ApiError && e.message) {
          toast.error("Clean-up failed", { description: e.message })
        } else {
          toast.error("Clean-up failed. Please try again.")
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

  function handleDeleteFeed() {
    if (!feedToDelete) return
    const name = feedToDelete.name
    deleteFeed.mutate(feedToDelete.id, {
      onSuccess: () => {
        setFeedToDelete(null)
        toast.success(`Deleted “${name}”`)
      },
      onError: () => toast.error("Couldn't delete that feed. Please try again."),
    })
  }

  // Which other synced calendars each preset color is already used by — keyed by
  // lowercased #rrggbb. Excludes the calendar being edited (passed per-row below).
  function usageExcluding(selfId: string): Record<string, string[]> {
    const map: Record<string, string[]> = {}
    for (const c of roster) {
      if (c.id === selfId || !c.synced || !c.color) continue
      const key = c.color.toLowerCase()
      ;(map[key] ??= []).push(c.name)
    }
    return map
  }

  function handleColor(cal: ExternalCalendarOut, color: string) {
    if (color.toLowerCase() === (cal.color ?? "").toLowerCase()) return
    const sharedWith = (usageExcluding(cal.id)[color.toLowerCase()] ?? [])
    setColor.mutate(
      { extCalId: cal.id, color },
      {
        onSuccess: () => {
          // Silent on a clean pick (the dot flips instantly); only speak up when
          // the color now matches another calendar, so it's a knowing choice.
          if (sharedWith.length > 0) {
            toast(`This color is also used by ${joinNames(sharedWith)}`, {
              description: "Both calendars will share it — that's okay.",
            })
          }
        },
        onError: () =>
          toast.error("Couldn't update the color. Please try again."),
      },
    )
  }

  function handleToggle(cal: ExternalCalendarOut, on: boolean) {
    setSync.mutate(
      { extCalId: cal.id, synced: on },
      {
        onSuccess: () =>
          toast.success(
            on
              ? `“${cal.name}” will sync into your calendar`
              : `Stopped syncing “${cal.name}”`,
          ),
        onError: () =>
          toast.error("Couldn't update that calendar. Please try again."),
      },
    )
  }

  return (
    <>
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
                {account.provider === "ics"
                  ? `${account.calendars.length} feed${
                      account.calendars.length === 1 ? "" : "s"
                    }`
                  : (account.account_email ?? "Connected account")}
              </p>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1.5">
            <Badge variant={needsReauth ? "destructive" : "secondary"}>
              {needsReauth ? (
                <>
                  <TriangleAlertIcon className="size-3" /> Reconnect needed
                </>
              ) : (
                "Connected"
              )}
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Account options"
                  className="text-muted-foreground -mr-1"
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={handleCleanup}
                  disabled={cleanupDuplicates.isPending}
                >
                  {cleanupDuplicates.isPending ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <WandSparklesIcon />
                  )}
                  Clean up duplicates
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  // Defer a tick so the menu finishes closing (and returning
                  // focus) before the dialog grabs it — otherwise radix's
                  // focus-return can immediately re-close the dialog.
                  onSelect={() =>
                    setTimeout(() => setConfirmDisconnect(true), 0)
                  }
                >
                  <Trash2Icon />
                  {isFeeds ? "Remove all feeds" : "Disconnect"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {needsReauth && (
            <p className="text-muted-foreground bg-muted/50 rounded-2xl px-3.5 py-2.5 text-sm">
              Access expired or was revoked. Reconnect this account above to
              resume syncing.
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
                  const synced = cal.synced
                  const isPending =
                    setSync.isPending && setSync.variables?.extCalId === cal.id
                  return (
                    <li
                      key={cal.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <CalendarColorPicker
                          value={cal.color}
                          label={cal.name}
                          usage={usageExcluding(cal.id)}
                          onSelect={(color) => handleColor(cal, color)}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {cal.name}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {synced
                              ? formatWhen(cal.last_synced_at)
                              : "Not syncing"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2.5">
                        {isPending && (
                          <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
                        )}
                        <Switch
                          checked={synced}
                          onCheckedChange={(on) => handleToggle(cal, on)}
                          disabled={isPending}
                          aria-label={`Sync ${cal.name}`}
                        />
                        {isFeeds && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${cal.name}`}
                            className="text-muted-foreground hover:text-destructive -mr-1"
                            onClick={() => setFeedToDelete(cal)}
                          >
                            <Trash2Icon />
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <Separator />

          <div className="flex justify-end">
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
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={feedToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setFeedToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{feedToDelete?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the feed <strong>and the events it added</strong> to your
              calendar. To just pause it, turn its sync switch off instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFeed.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                // Stay open until the request settles (handleDeleteFeed closes it).
                e.preventDefault()
                handleDeleteFeed()
              }}
              disabled={deleteFeed.isPending}
            >
              Delete feed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this account?</AlertDialogTitle>
            <AlertDialogDescription>
              New events will stop syncing. Events already pulled in stay on your
              calendar. You can reconnect anytime.
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
    </>
  )
}
