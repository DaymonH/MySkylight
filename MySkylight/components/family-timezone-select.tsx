"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { useApi } from "@/hooks/use-api"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface FamilyOut {
  id: string
  name: string
  timezone: string
}

interface MembershipResponse {
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

/** Full IANA zone list (current value + "UTC" guaranteed present). */
function listTimeZones(current: string): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[]
  }
  const zones = intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : []
  return Array.from(new Set<string>(["UTC", current, ...zones]))
}

/**
 * Per-family IANA timezone (PATCH /families/{id}). The backend expands recurring
 * events in this zone so wall-clock times survive daylight saving. Owners/adults
 * can change it; others see it read-only. Shares the `["family", familyId]`
 * query cache with FamilyNameEditor, so changing it live-updates both.
 */
export function FamilyTimezoneSelect({ familyId }: { familyId: string }) {
  const api = useApi()
  const qc = useQueryClient()

  const { data: family } = useQuery({
    queryKey: ["family", familyId],
    queryFn: () => api.get<FamilyOut>(`/families/${familyId}`),
  })
  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const role = memberships.find((m) => m.family_id === familyId)?.role
  const canEdit = role === "owner" || role === "adult"

  const current = family?.timezone ?? "America/Denver"

  const setTz = useMutation({
    mutationFn: (timezone: string) =>
      api.patch<FamilyOut>(`/families/${familyId}`, { timezone }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family", familyId] })
      // Occurrences are expanded server-side in the family zone — refetch them.
      qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
      toast.success("Timezone updated")
    },
    onError: () => toast.error("Couldn't update the timezone. Please try again."),
  })

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="family-tz">Timezone</Label>
      <p className="text-muted-foreground text-xs">
        Used to schedule recurring events correctly across daylight saving time.
      </p>
      {canEdit ? (
        <Select
          value={current}
          onValueChange={(v) => setTz.mutate(v)}
          disabled={setTz.isPending || !family}
        >
          <SelectTrigger id="family-tz" className="w-full sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {listTimeZones(current).map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-sm">{current}</p>
      )}
    </div>
  )
}
