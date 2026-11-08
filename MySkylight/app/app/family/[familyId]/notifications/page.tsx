"use client"

import { use } from "react"
import { toast } from "sonner"
import { BellIcon, BellOffIcon, InfoIcon, Loader2Icon, SendIcon } from "lucide-react"

import { useDisablePush, usePushState, useSavePush, useTestPush } from "@/hooks/use-push"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.message) return err.message
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * This phone's notification settings: turn them on, choose which kinds it gets, and
 * send a test. Notifications are per phone, so the switches belong to the phone you're
 * holding — other phones keep their own.
 */
export default function NotificationsPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params)
  const { data: state, isLoading, error } = usePushState(familyId)
  const save = useSavePush(familyId)
  const disable = useDisablePush(familyId)
  const test = useTestPush(familyId)

  const sub = state?.subscription ?? null
  const busy = save.isPending || disable.isPending

  function enable() {
    save.mutate(
      { events_enabled: true, chores_enabled: true },
      {
        onSuccess: () => toast.success("Notifications are on for this phone"),
        onError: (err) => toast.error(errorMessage(err, "Couldn't turn on notifications")),
      },
    )
  }

  function setPref(patch: Partial<{ events_enabled: boolean; chores_enabled: boolean }>) {
    if (!sub) return
    save.mutate(
      {
        events_enabled: patch.events_enabled ?? sub.events_enabled,
        chores_enabled: patch.chores_enabled ?? sub.chores_enabled,
      },
      { onError: (err) => toast.error(errorMessage(err, "Couldn't save that change")) },
    )
  }

  function sendTest() {
    if (!state?.endpoint) return
    test.mutate(state.endpoint, {
      onSuccess: (res) =>
        res.result === "ok"
          ? toast.success("Test sent", { description: "It should arrive in a moment." })
          : toast.error(
              res.result === "gone"
                ? "This phone's registration had expired. Turn notifications on again."
                : "The notification service didn't accept it. Try again in a moment.",
            ),
      onError: (err) => toast.error(errorMessage(err, "Couldn't send a test")),
    })
  }

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-xl flex-col gap-6 overflow-y-auto p-4 sm:p-6 [&>*]:shrink-0">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground text-sm">
          Get a reminder before an event, and an evening nudge when chores are still to do — even
          when the app is closed.
        </p>
      </header>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : error || !state ? (
        <p className="text-destructive text-sm">Couldn&rsquo;t check this phone. Try again.</p>
      ) : state.support === "needs-install" ? (
        <div className="text-muted-foreground bg-muted/50 flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm">
          <InfoIcon className="mt-0.5 size-4 flex-shrink-0" />
          <p>
            On iPhone, notifications only work once MySkylight is on your Home Screen. Tap{" "}
            <span className="font-medium">Share</span>, then{" "}
            <span className="font-medium">Add to Home Screen</span>, open it from there, and come
            back to this page.
          </p>
        </div>
      ) : state.support === "unsupported" ? (
        <div className="text-muted-foreground bg-muted/50 flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm">
          <InfoIcon className="mt-0.5 size-4 flex-shrink-0" />
          <p>This browser can&rsquo;t receive notifications. Try Chrome, Safari or Edge.</p>
        </div>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            <span className="bg-muted text-muted-foreground flex size-10 flex-shrink-0 items-center justify-center rounded-2xl">
              {sub ? <BellIcon className="size-5" /> : <BellOffIcon className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-tight">
                {sub ? "On for this phone" : "Off for this phone"}
              </p>
              <p className="text-muted-foreground text-sm">
                {state.permission === "denied"
                  ? "Blocked in your phone's settings"
                  : sub
                    ? "Choose what you want to hear about"
                    : "Turn on to get reminders here"}
              </p>
            </div>
            {sub ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  disable.mutate(undefined, {
                    onSuccess: () => toast.success("Notifications are off for this phone"),
                    onError: (err) => toast.error(errorMessage(err, "Couldn't turn them off")),
                  })
                }
              >
                Turn off
              </Button>
            ) : (
              <Button size="sm" disabled={busy || state.permission === "denied"} onClick={enable}>
                {save.isPending && <Loader2Icon className="animate-spin" />}
                Turn on
              </Button>
            )}
          </CardHeader>

          {state.permission === "denied" && !sub && (
            <CardContent>
              <p className="text-muted-foreground bg-muted/50 rounded-2xl px-3.5 py-2.5 text-sm">
                Notifications are blocked for MySkylight. Allow them in your phone&rsquo;s Settings
                (find MySkylight in the list), then come back and tap Turn on.
              </p>
            </CardContent>
          )}

          {sub && (
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="events" className="text-sm font-medium">
                    Event reminders
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    For events you&rsquo;re on, using the reminders set on each event.
                  </p>
                </div>
                <Switch
                  id="events"
                  checked={sub.events_enabled}
                  disabled={busy}
                  onCheckedChange={(events_enabled) => setPref({ events_enabled })}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="chores" className="text-sm font-medium">
                    Evening chore nudge
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    Around 5:30 pm, only if someone still has chores to do.
                  </p>
                </div>
                <Switch
                  id="chores"
                  checked={sub.chores_enabled}
                  disabled={busy}
                  onCheckedChange={(chores_enabled) => setPref({ chores_enabled })}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={test.isPending}
                onClick={sendTest}
              >
                {test.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                Send a test
              </Button>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
