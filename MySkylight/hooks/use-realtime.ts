"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

/**
 * Subscribes to the family's SSE stream and reconciles the TanStack Query cache
 * as `event.*` / `calendar.*` / `member.*` / `family.*` / `task.*` / `routine.*`
 * events arrive.
 *
 * Resilience: a plain `EventSource` auto-retries transient drops, but iOS Safari
 * tears the stream down when the tab is backgrounded and never resumes it — the
 * wall-display would silently go stale. So we also reconnect on `visibilitychange`
 * (foreground) and `online`, and on every *re*connect we resync all family-scoped
 * caches to catch up on anything missed while we were disconnected.
 */
export function useRealtime(familyId: string) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!familyId) return

    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let hasConnected = false
    let disposed = false // set on cleanup so async callbacks don't re-open

    // After a reconnect we may have missed events while disconnected, so refresh
    // every family-scoped cache. Skipped on the first connect (the page just
    // loaded with fresh data — invalidating then is a wasted refetch).
    function resync() {
      qc.invalidateQueries({ queryKey: ["occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["calendars", familyId] })
      qc.invalidateQueries({ queryKey: ["members", familyId] })
      qc.invalidateQueries({ queryKey: ["family", familyId] })
      qc.invalidateQueries({ queryKey: ["me", "memberships"] })
      qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      qc.invalidateQueries({ queryKey: ["tasks", familyId] })
      qc.invalidateQueries({ queryKey: ["routines", familyId] })
      qc.invalidateQueries({ queryKey: ["lists", familyId] })
      qc.invalidateQueries({ queryKey: ["rewards", familyId] })
      qc.invalidateQueries({ queryKey: ["star-balances", familyId] })
      qc.invalidateQueries({ queryKey: ["redemptions", familyId] })
    }

    function handle(msg: { type: string }) {
      if (msg.type === "connected") {
        if (hasConnected) resync()
        hasConnected = true
        return
      }
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
      if (msg.type.startsWith("task.")) {
        // task.created/updated/deleted + task.completed/uncompleted — refresh the
        // device chore board, the management list, streak badges, and (since
        // completing a chore earns stars) the reward star balances.
        qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
        qc.invalidateQueries({ queryKey: ["tasks", familyId] })
        qc.invalidateQueries({ queryKey: ["task-streak", familyId] })
        qc.invalidateQueries({ queryKey: ["star-balances", familyId] })
      }
      if (msg.type.startsWith("routine.")) {
        qc.invalidateQueries({ queryKey: ["routines", familyId] })
        qc.invalidateQueries({ queryKey: ["tasks", familyId] })
        qc.invalidateQueries({ queryKey: ["task-occurrences", familyId] })
      }
      if (msg.type.startsWith("list.")) {
        // list.created/updated/deleted/reordered + list.item_* — refresh the
        // shared lists on the companion app and the device board.
        qc.invalidateQueries({ queryKey: ["lists", familyId] })
      }
      if (msg.type.startsWith("reward.")) {
        // reward.created/updated/deleted + reward.redeemed/approved/rejected —
        // refresh the catalog, balances, and the approval queue.
        qc.invalidateQueries({ queryKey: ["rewards", familyId] })
        qc.invalidateQueries({ queryKey: ["star-balances", familyId] })
        qc.invalidateQueries({ queryKey: ["redemptions", familyId] })
      }
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, 3000)
    }

    function connect() {
      if (disposed) return
      es?.close()
      es = new EventSource(`/api/backend/api/v1/families/${familyId}/stream`)

      es.onmessage = (e: MessageEvent) => {
        try {
          handle(JSON.parse(e.data as string) as { type: string })
        } catch {
          // ignore malformed messages
        }
      }

      es.onerror = () => {
        // CONNECTING means the browser is already auto-retrying — leave it be.
        // CLOSED means it gave up (typical after an iOS background); reconnect.
        if (es?.readyState === EventSource.CLOSED) scheduleReconnect()
      }
    }

    // iOS drops SSE when the tab is backgrounded; re-establish on resume.
    function onVisible() {
      if (document.visibilityState !== "visible") return
      if (!es || es.readyState !== EventSource.OPEN) connect()
    }
    function onOnline() {
      connect()
    }

    connect()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", onOnline)

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onOnline)
      es?.close()
    }
  }, [familyId, qc])
}
