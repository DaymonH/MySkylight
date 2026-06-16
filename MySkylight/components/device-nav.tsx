"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarDaysIcon, GiftIcon, ListChecksIcon, ListTodoIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const TABS = [
  { href: "/device", label: "Calendar", icon: CalendarDaysIcon },
  { href: "/device/chores", label: "Chores", icon: ListChecksIcon },
  { href: "/device/lists", label: "Lists", icon: ListTodoIcon },
  { href: "/device/rewards", label: "Rewards", icon: GiftIcon },
]

/** Slim top nav for the wall-display kiosk — switches between device surfaces. */
export function DeviceNav() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-shrink-0 items-center gap-2 border-b px-4 py-2">
      <span className="mr-2 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <CalendarDaysIcon className="size-5" />
        </span>
        <span className="font-heading text-lg font-semibold tracking-tight">MySkylight</span>
      </span>
      {TABS.map((t) => {
        // Exact match for /device so it isn't also "active" on /device/chores.
        const active = t.href === "/device" ? pathname === "/device" : pathname.startsWith(t.href)
        const Icon = t.icon
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2 text-base font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
