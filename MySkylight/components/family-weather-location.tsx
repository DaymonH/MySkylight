"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2Icon, MapPinIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface FamilyOut {
  id: string
  name: string
  timezone: string
  weather_lat: number | null
  weather_lng: number | null
  weather_label: string | null
}

interface MembershipResponse {
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

interface LocationUpdate {
  weather_lat: number
  weather_lng: number
  weather_label?: string | null
}

/** Resolve the device's coordinates once, on demand (button click) — not on mount. */
function requestBrowserLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation isn't available on this device"))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  })
}

/**
 * Saved per-family weather location (PATCH /families/{id}). Set it once — from any
 * device — and the calendar reads the forecast from here, so the wall display and
 * every device stop prompting for browser geolocation on each open. Shares the
 * `["family", familyId]` query cache, so a save live-updates the calendar's weather.
 */
export function FamilyWeatherLocation({ familyId }: { familyId: string }) {
  const api = useApi()
  const qc = useQueryClient()
  const [lat, setLat] = useState("")
  const [lng, setLng] = useState("")
  const [label, setLabel] = useState("")

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

  const save = useMutation({
    mutationFn: (body: LocationUpdate) =>
      api.patch<FamilyOut>(`/families/${familyId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family", familyId] })
      // The calendar's forecast is keyed on these coords — refetch it.
      qc.invalidateQueries({ queryKey: ["weather", familyId] })
      toast.success("Weather location saved")
      setLat("")
      setLng("")
      setLabel("")
    },
    onError: () => toast.error("Couldn't save the location. Please try again."),
  })

  const hasLocation = family?.weather_lat != null && family?.weather_lng != null
  const current =
    family?.weather_label ||
    (hasLocation
      ? `${family!.weather_lat!.toFixed(4)}, ${family!.weather_lng!.toFixed(4)}`
      : "Not set")

  function useMyLocation() {
    requestBrowserLocation()
      .then(({ lat, lng }) => save.mutate({ weather_lat: lat, weather_lng: lng }))
      .catch(() =>
        toast.error(
          "Couldn't get your location. Allow location access, or enter it manually below.",
        ),
      )
  }

  function saveManual() {
    const la = Number.parseFloat(lat)
    const ln = Number.parseFloat(lng)
    if (
      Number.isNaN(la) ||
      Number.isNaN(ln) ||
      la < -90 ||
      la > 90 ||
      ln < -180 ||
      ln > 180
    ) {
      toast.error("Enter a valid latitude (−90 to 90) and longitude (−180 to 180).")
      return
    }
    save.mutate({ weather_lat: la, weather_lng: ln, weather_label: label.trim() || null })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label>Weather location</Label>
        <p className="text-muted-foreground text-xs">
          Set once for the whole family. The calendar reads the forecast from here, so
          no device asks for your location each time it opens.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <MapPinIcon className="text-muted-foreground size-4 flex-shrink-0" />
        <span className={hasLocation ? "" : "text-muted-foreground"}>{current}</span>
      </div>

      {canEdit && (
        <>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={useMyLocation}
              disabled={save.isPending}
            >
              {save.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <MapPinIcon />
              )}
              Use my current location
            </Button>
          </div>

          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer text-xs">
              Or enter coordinates manually
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Latitude"
                  inputMode="decimal"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
                <Input
                  placeholder="Longitude"
                  inputMode="decimal"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                />
              </div>
              <Input
                placeholder="Label (optional, e.g. Home)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <div>
                <Button size="sm" onClick={saveManual} disabled={save.isPending}>
                  Save location
                </Button>
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
