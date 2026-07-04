"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2Icon, type LucideIcon } from "lucide-react"

import { useDeviceFamily } from "@/hooks/use-device-family"

interface DeviceFamilyGateProps {
  /** Section icon shown in the branded splash while loading. */
  icon: LucideIcon
  /** Section-specific loading copy, e.g. "Loading your calendar…". */
  label: string
  children: (familyId: string) => React.ReactNode
}

/**
 * Gates every `/device` page on the family membership lookup, rendering the
 * branded splash while it loads or the backend is briefly unreachable.
 *
 * A kiosk must never wander off `/device` on a transient blip — that's how it
 * used to end up on the `/app` phone surface (via `/sign-in` → `/`) and prompt
 * to "create a family". So we only navigate away when the session is genuinely
 * gone (`unauthorized`); the surface-aware root route then lands re-auth back
 * on `/device`.
 */
export function DeviceFamilyGate({
  icon: Icon,
  label,
  children,
}: DeviceFamilyGateProps) {
  const { status, familyId } = useDeviceFamily()
  const router = useRouter()

  useEffect(() => {
    if (status === "unauthorized") router.push("/sign-in")
  }, [status, router])

  if (status === "ready" && familyId) {
    return children(familyId)
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-2xl shadow-md">
          <Icon className="size-7" />
        </span>
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            MySkylight
          </h1>
          <p className="text-muted-foreground mt-1.5 flex items-center justify-center gap-2 text-sm">
            <Loader2Icon className="size-4 animate-spin" />
            {status === "reconnecting" ? "Reconnecting…" : label}
          </p>
        </div>
      </div>
    </div>
  )
}
