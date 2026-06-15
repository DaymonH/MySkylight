"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

export function useRealtime(familyId: string) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!familyId) return

    const es = new EventSource(`/api/backend/api/v1/families/${familyId}/stream`)

    es.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string }
        if (msg.type === "connected") return
        if (msg.type.startsWith("event.")) {
          qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
        }
        if (msg.type.startsWith("calendar.")) {
          qc.invalidateQueries({ queryKey: ["calendars", familyId] })
          qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
        }
        if (msg.type.startsWith("member.")) {
          // Refreshes the members page list and the calendar's profile switcher.
          qc.invalidateQueries({ queryKey: ["members", familyId] })
        }
        if (msg.type.startsWith("family.")) {
          // family.updated — keep the family header (name) and membership cache fresh.
          qc.invalidateQueries({ queryKey: ["family", familyId] })
          qc.invalidateQueries({ queryKey: ["me", "memberships"] })
        }
      } catch {
        // ignore malformed messages
      }
    }

    return () => es.close()
  }, [familyId, qc])
}
