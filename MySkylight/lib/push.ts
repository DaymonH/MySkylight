import type { makeApi } from "@/lib/api-client"

type Api = ReturnType<typeof makeApi>

/**
 * Whether this browser can receive pushes at all.
 *
 * `needs-install` is the iPhone case that matters: Safari has no push for web pages,
 * only for a web app opened from the Home Screen (iOS 16.4+). The APIs are simply
 * absent in a Safari tab, so absence on iOS means "install it", not "impossible".
 */
export type PushSupport = "supported" | "needs-install" | "unsupported"

export interface PushPrefs {
  events_enabled: boolean
  chores_enabled: boolean
}

export interface PushSubscriptionOut extends PushPrefs {
  endpoint: string
}

const isIOS = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac.
  (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)

const isStandalone = (): boolean =>
  window.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Client-only (touches `navigator`): call from an effect, query function or handler. */
export function pushSupport(): PushSupport {
  const hasApis =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  if (hasApis) return "supported"
  return isIOS() && !isStandalone() ? "needs-install" : "unsupported"
}

export const notificationPermission = (): NotificationPermission =>
  "Notification" in window ? Notification.permission : "denied"

const fromBase64Url = (value: string): Uint8Array => {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array): boolean => {
  if (!a) return false
  const left = new Uint8Array(a)
  return left.length === b.length && left.every((byte, i) => byte === b[i])
}

/** This browser's own push subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "supported") return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

/**
 * Subscribe this phone and register it with the API (or update its switches).
 *
 * The first call must come from a tap: iOS refuses a permission prompt that isn't a
 * direct response to user input. Safe to call again — a subscription made with an
 * old server key can never be delivered to, so it is replaced rather than reused.
 */
export async function subscribeThisDevice(
  api: Api,
  familyId: string,
  prefs: PushPrefs,
): Promise<PushSubscriptionOut> {
  if (pushSupport() !== "supported") throw new Error("Notifications aren't available here")
  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission()
    if (permission !== "granted") {
      throw new Error(
        permission === "denied"
          ? "Notifications are blocked for this app. Allow them in the phone's Settings."
          : "Notifications weren't allowed.",
      )
    }
  }

  const { public_key } = await api.get<{ public_key: string }>(
    `/families/${familyId}/push/public-key`,
  )
  const serverKey = fromBase64Url(public_key)
  const registration = await navigator.serviceWorker.ready

  let subscription = await registration.pushManager.getSubscription()
  if (subscription && !sameKey(subscription.options.applicationServerKey, serverKey)) {
    await subscription.unsubscribe()
    subscription = null
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey as BufferSource,
    })
  }

  const json = subscription.toJSON()
  return api.put<PushSubscriptionOut>(`/families/${familyId}/push/subscription`, {
    endpoint: json.endpoint,
    keys: json.keys,
    user_agent: navigator.userAgent.slice(0, 255),
    ...prefs,
  })
}

/** Stop notifications on THIS phone (other phones keep theirs). */
export async function unsubscribeThisDevice(api: Api, familyId: string): Promise<void> {
  const subscription = await currentSubscription()
  if (!subscription) return
  await api.delete(
    `/families/${familyId}/push/subscription?endpoint=${encodeURIComponent(subscription.endpoint)}`,
  )
  await subscription.unsubscribe()
}
