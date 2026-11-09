import { CalendarDaysIcon } from "lucide-react"

import { SettingsButton } from "@/components/settings-dialog"
import { FamilyMenu } from "@/components/family-menu"
import { BottomNav } from "@/components/bottom-nav"
import { SurfaceMarker } from "@/components/surface-marker"

export const metadata = { title: "MySkylight" }

// The shell is pinned to the viewport (`fixed inset-0`, not h-dvh) so the page itself can
// never scroll or rubber-band: only the content inside <main> scrolls and the bottom bar
// stays put on iOS. Being fixed, it ignores the body's safe-area padding, so it applies
// the top/side insets itself (the bottom inset lives on the bottom nav).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-foreground">
      <SurfaceMarker surface="app" />
      <header className="sticky top-0 z-30 flex h-14 flex-shrink-0 items-center justify-between border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <CalendarDaysIcon className="size-5" />
          </span>
          <span className="font-heading text-lg font-semibold tracking-tight">
            MySkylight
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Phones navigate with the bottom bar instead. */}
          <div className="hidden sm:block">
            <FamilyMenu />
          </div>
          <SettingsButton />
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <BottomNav />
    </div>
  )
}
