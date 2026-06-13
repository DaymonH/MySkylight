"use client"

import { useUser } from "@clerk/nextjs"
import { useQuery } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { CalendarView } from "@/components/calendar/calendar-view"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

export default function DevicePage() {
  const { user, isLoaded } = useUser()
  const api = useApi()
  const router = useRouter()

  const { data: memberships = [], isError } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
    enabled: isLoaded && !!user,
    retry: false,
  })

  const familyId = memberships[0]?.family_id

  useEffect(() => {
    if (isError) router.push("/sign-in")
  }, [isError, router])

  if (!isLoaded || !familyId) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-center">
          <h1 className="font-heading text-4xl font-bold">MySkylight</h1>
          <p className="text-muted-foreground mt-2">Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <CalendarView familyId={familyId} defaultView="week" />
    </div>
  )
}
