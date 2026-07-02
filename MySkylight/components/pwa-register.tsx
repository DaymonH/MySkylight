"use client"

import { useEffect } from "react"

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    const sw = navigator.serviceWorker

    // When a new SW takes control after a deploy, reload once so the running
    // client swaps onto the fresh build. This is what lets the always-on kiosk
    // pick up deploys unattended — it never navigates, so without this it would
    // keep executing stale JS indefinitely.
    let reloading = false
    // The very first install also fires controllerchange (via clients.claim());
    // only reload when there was already a controller, i.e. a genuine update.
    const hadController = !!sw.controller
    const onControllerChange = () => {
      if (!hadController || reloading) return
      reloading = true
      window.location.reload()
    }
    sw.addEventListener("controllerchange", onControllerChange)

    let reg: ServiceWorkerRegistration | undefined
    sw.register("/sw.js")
      .then((r) => {
        reg = r
        r.update().catch(() => {})
      })
      .catch(() => {})

    // Chrome only checks for a new SW on navigation or roughly once a day. The
    // kiosk sits on one page for days, so actively poll for a new version and
    // re-check whenever the tab regains focus, so deploys land within minutes.
    const check = () => reg?.update().catch(() => {})
    const interval = window.setInterval(check, 30 * 60 * 1000) // 30 min
    const onVisible = () => {
      if (document.visibilityState === "visible") check()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      sw.removeEventListener("controllerchange", onControllerChange)
      document.removeEventListener("visibilitychange", onVisible)
      window.clearInterval(interval)
    }
  }, [])
  return null
}
