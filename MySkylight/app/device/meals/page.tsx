"use client"

import { useUser } from "@clerk/nextjs"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader2Icon, UtensilsCrossedIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { MealBoard } from "@/components/meals/meal-board"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

export default function DeviceMealsPage() {
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
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-2xl shadow-md">
            <UtensilsCrossedIcon className="size-7" />
          </span>
          <div>
            <h1 className="font-heading text-3xl font-bold tracking-tight">MySkylight</h1>
            <p className="text-muted-foreground mt-1.5 flex items-center justify-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              Loading meals…
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <MealBoard familyId={familyId} />
    </div>
  )
}
