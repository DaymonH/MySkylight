"use client"

import { use, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CalendarSyncIcon,
  InfoIcon,
  Loader2Icon,
  PlusIcon,
} from "lucide-react"

import {
  useExternalAccounts,
  useGoogleAuthorize,
} from "@/hooks/use-external-calendars"
import { useRealtime } from "@/hooks/use-realtime"
import { ApiError } from "@/lib/api-client"
import { AppleConnectDialog } from "@/components/integrations/apple-connect-dialog"
import { ExternalAccountCard } from "@/components/integrations/external-account-card"
import { IcsFeedDialog } from "@/components/integrations/ics-feed-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export default function IntegrationsPage({
  params,
}: {
  params: Promise<{ familyId: string }>
}) {
  const { familyId } = use(params)
  const qc = useQueryClient()
  const [appleOpen, setAppleOpen] = useState(false)
  const [icsOpen, setIcsOpen] = useState(false)

  // Mirrored events arrive as ordinary occurrences via the SSE bus; keep the
  // calendar caches live while this page is open (and on other devices).
  useRealtime(familyId)

  const { data: accounts = [], isLoading } = useExternalAccounts(familyId)
  const googleAuth = useGoogleAuthorize(familyId)

  // The OAuth callback bounces back here with ?external=connected|error. Surface
  // the outcome, then strip the param so a refresh doesn't re-toast. Reading from
  // window (not useSearchParams) keeps this client-only — no Suspense boundary.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const outcome = sp.get("external")
    if (!outcome) return
    if (outcome === "connected") {
      toast.success("Google account connected")
      qc.invalidateQueries({ queryKey: ["external-accounts", familyId] })
    } else if (outcome === "error") {
      toast.error("Couldn't connect that account. Please try again.")
    }
    sp.delete("external")
    const qs = sp.toString()
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""))
  }, [familyId, qc])

  function connectGoogle() {
    googleAuth.mutate(undefined, {
      onSuccess: (res) => {
        window.location.href = res.authorize_url
      },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 503) {
          toast.error("Google Calendar sync isn't configured on this server.")
        } else {
          toast.error("Couldn't start Google sign-in. Please try again.")
        }
      },
    })
  }

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-xl flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          Calendar sync
        </h1>
        <p className="text-muted-foreground text-sm">
          Connect Google or Apple, or subscribe to a calendar feed, to mirror
          their events here.
        </p>
      </header>

      <div className="text-muted-foreground bg-muted/50 flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm">
        <InfoIcon className="mt-0.5 size-4 flex-shrink-0" />
        <p>
          Synced calendars are <span className="font-medium">read-only</span> —
          their events show on your calendar but are edited in their source app,
          not here.
        </p>
      </div>

      {/* Connect a new account */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm font-medium">Add an account</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={connectGoogle} disabled={googleAuth.isPending}>
              {googleAuth.isPending ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              Connect Google
            </Button>
            <Button variant="outline" onClick={() => setAppleOpen(true)}>
              <PlusIcon />
              Connect iCloud
            </Button>
            <Button variant="outline" onClick={() => setIcsOpen(true)}>
              <PlusIcon />
              Subscribe to a feed
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Connected accounts */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-3xl" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
            <CalendarSyncIcon className="size-6" />
          </div>
          <div>
            <p className="font-medium">No connected calendars</p>
            <p className="text-muted-foreground text-sm">
              Connect Google or iCloud to start mirroring events.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {accounts.map((account) => (
            <ExternalAccountCard
              key={account.id}
              familyId={familyId}
              account={account}
            />
          ))}
        </div>
      )}

      <AppleConnectDialog
        familyId={familyId}
        open={appleOpen}
        onOpenChange={setAppleOpen}
      />
      <IcsFeedDialog
        familyId={familyId}
        open={icsOpen}
        onOpenChange={setIcsOpen}
      />
    </div>
  )
}
