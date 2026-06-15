"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckIcon, PencilIcon, XIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

interface FamilyOut {
  id: string
  name: string
}

interface MembershipResponse {
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

/**
 * The family name shown as the page title, with inline rename for owners/adults
 * (PATCH /families/{id}). Backed by the `["family", familyId]` query so a rename
 * from another device live-updates here via the SSE `family.updated` event.
 */
export function FamilyNameEditor({ familyId }: { familyId: string }) {
  const api = useApi()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  const { data: family, isLoading } = useQuery({
    queryKey: ["family", familyId],
    queryFn: () => api.get<FamilyOut>(`/families/${familyId}`),
  })

  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const role = memberships.find((m) => m.family_id === familyId)?.role
  const canEdit = role === "owner" || role === "adult"

  const rename = useMutation({
    mutationFn: (name: string) => api.patch<FamilyOut>(`/families/${familyId}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family", familyId] })
      qc.invalidateQueries({ queryKey: ["me", "memberships"] })
      setEditing(false)
      toast.success("Family name updated")
    },
    onError: () => toast.error("Couldn't update the family name. Please try again."),
  })

  function startEditing() {
    setDraft(family?.name ?? "")
    setEditing(true)
  }

  function submit() {
    const name = draft.trim()
    if (!name || name === family?.name) {
      setEditing(false)
      return
    }
    rename.mutate(name)
  }

  if (isLoading) return <Skeleton className="h-7 w-48 rounded" />

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit()
            if (e.key === "Escape") setEditing(false)
          }}
          maxLength={255}
          autoFocus
          aria-label="Family name"
          className="h-9 max-w-xs"
        />
        <Button size="icon-sm" onClick={submit} disabled={rename.isPending} aria-label="Save name">
          <CheckIcon />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel">
          <XIcon />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <h1 className="font-heading text-xl font-bold tracking-tight">{family?.name ?? "Family"}</h1>
      {canEdit && (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={startEditing}
          aria-label="Edit family name"
          className="text-muted-foreground"
        >
          <PencilIcon />
        </Button>
      )}
    </div>
  )
}
