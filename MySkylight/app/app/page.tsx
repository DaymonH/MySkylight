"use client"

import { useUser } from "@clerk/nextjs"
import { useQuery } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader2Icon } from "lucide-react"
import { CalendarView } from "@/components/calendar/calendar-view"

interface MeResponse {
  id: string
  email: string
  first_name: string | null
}

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

export default function AppHomePage() {
  const { user, isLoaded } = useUser()
  const api = useApi()
  const router = useRouter()

  const { data: me, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<MeResponse>("/me"),
    enabled: isLoaded && !!user,
    retry: false,
  })

  const { data: memberships = [], isPending: membershipsPending } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
    enabled: !!me,
  })

  const familyId = memberships[0]?.family_id

  useEffect(() => {
    if (isError) router.push("/app/onboarding")
  }, [isError, router])

  useEffect(() => {
    if (me && !membershipsPending && memberships.length === 0) router.push("/app/onboarding")
  }, [me, memberships, membershipsPending, router])

  if (!isLoaded || !familyId) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
        <Loader2Icon className="size-4 animate-spin" />
        Loading your calendar…
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CalendarView familyId={familyId} defaultView="schedule" storageKey="skylight:view:app:v2" surface="app" />
    </div>
  )
}
