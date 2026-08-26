"use client"

import { useEffect, useRef } from "react"
import { useAuth } from "@clerk/nextjs"
import { useQueryClient } from "@tanstack/react-query"

import { createSseParser } from "@/lib/sse"

// Direct-to-API base, e.g. https://skylight-api.daymonhansen.com. Set this in
// production. Left unset, the stream falls back to the same-origin proxy route —
// fine locally, ruinous on a serverless host; see the comment on `streamUrl`.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""
const JWT_TEMPLATE = process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE

// Reconnect backoff. Flat 3s while things are healthy; backs off when the server
// keeps refusing us (an expired session, say) so a broken stream can't hammer the
// backend twenty times a minute, forever, on an always-on kiosk.
const RECONNECT_MIN_MS = 3_000
const RECONNECT_MAX_MS = 30_000

/**
 * Subscribes to the family's SSE stream and reconciles the TanStack Query cache
 * as `event.*` / `calendar.*` / `member.*` / `family.*` / `task.*` / `routine.*` /
 * `list.*` / `reward.*` / `recipe.*` / `mealplan.*` events arrive.
 *
 * Transport is `fetch` + a streamed body rather than `EventSource`, because
 * `EventSource` cannot send an `Authorization` header and the backend accepts
 * bearer tokens only there. Reading the stream by hand is what lets the browser
 * hold the connection open against the API directly, instead of relaying it
 * through the Next proxy route.
 *
 * Resilience: we reconnect on `visibilitychange` (foreground) and `online` — iOS
 * Safari tears the stream down when the tab is backgrounded and never resumes it,
 * which would leave the wall display silently stale — and on every *re*connect we
 * resync all family-scoped caches to catch up on anything missed.
 */
export function useRealtime(familyId: string) {
  const qc = useQueryClient()
  const { getToken } = useAuth()

  // Held in a ref so a new `getToken` identity from Clerk can't tear down and
  // re-establish the stream: the effect intentionally depends only on familyId.
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken

  useEffect(() => {
    if (!familyId) return

    let abort: AbortController | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectDelay = RECONNECT_MIN_MS
    let hasConnected = false
    let streaming = false
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
      qc.invalidateQueries({ queryKey: ["recipes", familyId] })
      qc.invalidateQueries({ queryKey: ["mealplans", familyId] })
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
      if (msg.type.startsWith("recipe.")) {
        // recipe.created/updated/deleted — refresh the recipe library.
        qc.invalidateQueries({ queryKey: ["recipes", familyId] })
      }
      if (msg.type.startsWith("mealplan.")) {
        // mealplan.created/updated/deleted — refresh the weekly meal board.
        qc.invalidateQueries({ queryKey: ["mealplans", familyId] })
      }
    }

    function onData(data: string) {
      try {
        handle(JSON.parse(data) as { type: string })
      } catch {
        // ignore malformed messages
      }
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return
      const delay = reconnectDelay
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        void connect()
      }, delay)
    }

    async function connect() {
      if (disposed || streaming) return
      abort?.abort()
      const controller = new AbortController()
      abort = controller
      streaming = true

      try {
        // Falls back to the same-origin proxy path when no direct API base is
        // configured. In production that relay is a serverless function: it's
        // killed at the platform's execution limit, so the stream churns —
        // reconnecting every few seconds forever, each cycle costing an
        // invocation and triggering a full cache resync. Held directly against
        // the API, one connection lasts hours.
        const streamUrl = API_BASE_URL
          ? `${API_BASE_URL.replace(/\/$/, "")}/api/v1/families/${familyId}/stream`
          : `/api/backend/api/v1/families/${familyId}/stream`

        const headers: Record<string, string> = {}
        if (API_BASE_URL) {
          // Going direct means minting the token here — the proxy route is what
          // normally does that server-side.
          const token = await getTokenRef.current(
            JWT_TEMPLATE ? { template: JWT_TEMPLATE } : undefined,
          )
          if (!token) {
            streaming = false
            scheduleReconnect()
            return
          }
          headers.Authorization = `Bearer ${token}`
        }

        const res = await fetch(streamUrl, {
          headers,
          signal: controller.signal,
          cache: "no-store",
          credentials: API_BASE_URL ? "omit" : "same-origin",
        })

        if (!res.ok || !res.body) {
          streaming = false
          scheduleReconnect()
          return
        }

        // Connected — reset the backoff so the next genuine drop retries promptly.
        reconnectDelay = RECONNECT_MIN_MS

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        const parser = createSseParser(onData)

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          parser.push(decoder.decode(value, { stream: true }))
        }

        // Server closed the stream cleanly — reconnect and resync.
        streaming = false
        scheduleReconnect()
      } catch {
        // Network error, or our own abort during cleanup/reconnect.
        streaming = false
        if (!disposed && !controller.signal.aborted) scheduleReconnect()
      }
    }

    // iOS drops SSE when the tab is backgrounded; re-establish on resume.
    function reconnectNow() {
      if (disposed || streaming) return
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      reconnectDelay = RECONNECT_MIN_MS
      void connect()
    }

    function onVisible() {
      if (document.visibilityState !== "visible") return
      reconnectNow()
    }

    void connect()
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", reconnectNow)

    return () => {
      disposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", reconnectNow)
      abort?.abort()
    }
  }, [familyId, qc])
}
