import type { Metadata, Viewport } from "next"

import { DeviceSidebar } from "@/components/device-sidebar"
import { KioskScale } from "@/components/kiosk-scale"
import { SurfaceMarker } from "@/components/surface-marker"

// Override the root manifest so adding /device to the Home Screen installs a
// kiosk PWA that launches at /device (the root manifest's start_url is /app).
export const metadata: Metadata = {
  title: "MySkylight — Device",
  manifest: "/device-manifest.json",
  appleWebApp: {
    capable: true,
    title: "MySkylight Kiosk",
    statusBarStyle: "default",
  },
}

// Replaces the root viewport for /device only: the phone companion keeps normal
// pinch-zoom (accessibility), the wall kiosk does not.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
}

export default function DeviceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground flex h-screen w-screen overflow-hidden">
      <SurfaceMarker surface="device" />
      <KioskScale />
      <DeviceSidebar />
      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
