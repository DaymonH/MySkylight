import { UserButton } from "@clerk/nextjs"
import { CalendarDaysIcon } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"

export const metadata = { title: "MySkylight" }

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
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
          <ThemeToggle />
          <UserButton appearance={{ elements: { avatarBox: "size-8" } }} />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}
