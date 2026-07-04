"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { CalendarDaysIcon, Loader2Icon } from "lucide-react"

import { SURFACE_STORAGE_KEY } from "@/components/surface-marker"

// `/` is a router, not a destination. It routes to whichever surface this
// install last used so a bare `/` load on the kiosk (re-auth landing, a kiosk-
// browser reload of the origin) returns to `/device` instead of falling through
// to the `/app` phone companion — which is how the kiosk used to end up on the
// wrong surface and prompt to "create a family". Phones have no marker and get
// `/app`.
export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    let surface: string | null = null
    try {
      surface = localStorage.getItem(SURFACE_STORAGE_KEY)
    } catch {
      // Storage unavailable — fall back to the phone companion.
    }
    router.replace(surface === "device" ? "/device" : "/app")
  }, [router])

  return (
    <div className="flex min-h-svh w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-2xl shadow-md">
          <CalendarDaysIcon className="size-7" />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">MySkylight</h1>
          <p className="text-muted-foreground mt-1.5 flex items-center justify-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            Loading…
          </p>
        </div>
      </div>
    </div>
  )
}
