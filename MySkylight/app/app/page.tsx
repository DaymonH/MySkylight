"use client"

import { useUser } from "@clerk/nextjs"
import { useQuery } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import Link from "next/link"

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

  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
    enabled: !!me,
  })

  const familyId = memberships[0]?.family_id

  useEffect(() => {
    if (isError) router.push("/app/onboarding")
  }, [isError, router])

  useEffect(() => {
    if (me && memberships.length === 0) router.push("/app/onboarding")
  }, [me, memberships, router])

  if (!isLoaded) {
    return <div className="flex flex-1 items-center justify-center">Loading…</div>
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4">
      <div>
        <h1 className="font-heading text-2xl font-bold">
          Hello, {user?.firstName ?? me?.email ?? "there"}
        </h1>
        <p className="text-muted-foreground text-sm">Your family calendar</p>
      </div>

      {familyId && (
        <nav className="flex flex-col gap-2">
          <Link
            href={`/app/family/${familyId}/members`}
            className="bg-card border-border hover:bg-accent flex items-center gap-3 rounded-lg border p-4 transition-colors"
          >
            <span className="text-2xl">👨‍👩‍👧‍👦</span>
            <div>
              <p className="font-medium">Family Members</p>
              <p className="text-muted-foreground text-sm">Manage calendar profiles</p>
            </div>
          </Link>
        </nav>
      )}

      <div className="text-muted-foreground rounded-xl border border-dashed p-12 text-center text-sm">
        Calendar view coming in Phase 2
      </div>
    </div>
  )
}
