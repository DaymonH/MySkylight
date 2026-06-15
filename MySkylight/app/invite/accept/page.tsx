"use client"

import { Suspense, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useUser } from "@clerk/nextjs"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CalendarDaysIcon, CheckCircle2Icon, Loader2Icon, MailXIcon, PartyPopperIcon,
} from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface AcceptResult {
  family_id: string
  role: string
  member_id: string
  already_member: boolean
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">{children}</Card>
    </div>
  )
}

function AcceptInner() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const { isLoaded, isSignedIn } = useUser()
  const api = useApi()
  const router = useRouter()
  const qc = useQueryClient()
  const started = useRef(false)

  const accept = useMutation({
    mutationFn: (t: string) => api.post<AcceptResult>("/invitations/accept", { token: t }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me", "memberships"] })
      setTimeout(() => router.push("/app"), 1600)
    },
  })

  // Accept exactly once, as soon as we have a signed-in user and a token.
  useEffect(() => {
    if (isLoaded && isSignedIn && token && !started.current) {
      started.current = true
      accept.mutate(token)
    }
  }, [isLoaded, isSignedIn, token, accept])

  // 1. No token → broken link.
  if (!token) {
    return (
      <Shell>
        <CardHeader className="items-center text-center">
          <span className="bg-muted text-muted-foreground mb-2 flex size-12 items-center justify-center rounded-2xl">
            <MailXIcon className="size-6" />
          </span>
          <CardTitle className="text-xl">Invalid invite link</CardTitle>
          <CardDescription>
            This link is missing its invitation token. Ask the family to send you a new one.
          </CardDescription>
        </CardHeader>
      </Shell>
    )
  }

  // 2. Clerk still loading.
  if (!isLoaded) {
    return (
      <Shell>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
          <Loader2Icon className="size-4 animate-spin" /> Loading…
        </CardContent>
      </Shell>
    )
  }

  // 3. Signed out → prompt to sign in / up, returning here afterwards.
  if (!isSignedIn) {
    const returnTo = `/invite/accept?token=${encodeURIComponent(token)}`
    const q = `redirect_url=${encodeURIComponent(returnTo)}`
    return (
      <Shell>
        <CardHeader className="items-center text-center">
          <span className="bg-primary text-primary-foreground mb-2 flex size-12 items-center justify-center rounded-2xl shadow-sm">
            <CalendarDaysIcon className="size-6" />
          </span>
          <CardTitle className="text-xl">You&apos;re invited!</CardTitle>
          <CardDescription>
            Sign in or create an account to join this family calendar.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button asChild size="lg">
            <Link href={`/sign-up?${q}`}>Create account</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/sign-in?${q}`}>Sign in</Link>
          </Button>
        </CardContent>
      </Shell>
    )
  }

  // 4. Signed in + accepting failed.
  if (accept.isError) {
    const status = accept.error instanceof ApiError ? accept.error.status : undefined
    const message =
      status === 410
        ? "This invitation has expired. Ask the family to send a new one."
        : status === 404
          ? "This invitation is no longer valid — it may have been used already or revoked."
          : "Something went wrong accepting this invite. Please try again."
    return (
      <Shell>
        <CardHeader className="items-center text-center">
          <span className="bg-muted text-muted-foreground mb-2 flex size-12 items-center justify-center rounded-2xl">
            <MailXIcon className="size-6" />
          </span>
          <CardTitle className="text-xl">Can&apos;t accept invite</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/app">Go to my calendar</Link>
          </Button>
        </CardContent>
      </Shell>
    )
  }

  // 5. Signed in + success.
  if (accept.isSuccess) {
    const alreadyMember = accept.data?.already_member
    return (
      <Shell>
        <CardHeader className="items-center text-center">
          <span className="bg-primary text-primary-foreground mb-2 flex size-12 items-center justify-center rounded-2xl shadow-sm">
            {alreadyMember ? <CheckCircle2Icon className="size-6" /> : <PartyPopperIcon className="size-6" />}
          </span>
          <CardTitle className="text-xl">
            {alreadyMember ? "You're already in this family" : "You're in!"}
          </CardTitle>
          <CardDescription>Taking you to the calendar…</CardDescription>
        </CardHeader>
      </Shell>
    )
  }

  // 6. Signed in + accepting in progress.
  return (
    <Shell>
      <CardContent className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Joining the family…
      </CardContent>
    </Shell>
  )
}

export default function InviteAcceptPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <CardContent className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
            <Loader2Icon className="size-4 animate-spin" /> Loading…
          </CardContent>
        </Shell>
      }
    >
      <AcceptInner />
    </Suspense>
  )
}
