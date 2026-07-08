"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpenIcon,
  CalendarDaysIcon,
  GiftIcon,
  ListChecksIcon,
  ListTodoIcon,
  UtensilsCrossedIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { SettingsButton } from "@/components/settings-dialog"

const TABS = [
  { href: "/device", label: "Calendar", icon: CalendarDaysIcon },
  { href: "/device/chores", label: "Chores", icon: ListChecksIcon },
  { href: "/device/lists", label: "Lists", icon: ListTodoIcon },
  { href: "/device/meals", label: "Meals", icon: UtensilsCrossedIcon },
  { href: "/device/recipes", label: "Recipes", icon: BookOpenIcon },
  { href: "/device/rewards", label: "Rewards", icon: GiftIcon },
]

/** Shared visual for a single rail item — icon stacked over a small label. */
// rem-based sizes (w-18 = 4.5rem, text-[0.6875rem] = 11px) so the whole rail
// scales with the kiosk --kiosk-scale knob rather than staying pinned in px.
export const RAIL_ITEM =
  "flex w-18 flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-[0.6875rem] font-medium transition-colors"

/** Vertical icon-rail nav for the wall-display kiosk — switches between device surfaces. */
export function DeviceSidebar() {
  const pathname = usePathname()

  return (
    <nav className="bg-muted/40 flex w-20 flex-shrink-0 flex-col items-center gap-1 border-r py-3">
      <span className="bg-primary text-primary-foreground mb-2 flex size-11 items-center justify-center rounded-2xl shadow-sm">
        <span className="font-heading text-xl font-bold">M</span>
      </span>

      <div className="flex flex-1 flex-col items-center gap-1">
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
                RAIL_ITEM,
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-6" />
              {t.label}
            </Link>
          )
        })}
      </div>

      <SettingsButton
        label="Settings"
        className={cn(
          RAIL_ITEM,
          "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      />
    </nav>
  )
}
