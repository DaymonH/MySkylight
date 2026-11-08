"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { EllipsisIcon } from "lucide-react"

import { NavMenuItem, useFamilyNav } from "@/components/family-menu"
import { isActive, type NavItem } from "@/components/app-nav-items"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

const TAB = "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors"

/**
 * Phone-only tab bar: the four everyday pages one tap away, everything else under
 * "More". Hidden from `sm` up, where the header menu is used instead.
 */
export function BottomNav() {
  const pathname = usePathname()
  const fam = useFamilyNav()
  if (!fam) return null
  const { canManage, nav } = fam
  const keep = (i: NavItem) => !i.adultOnly || canManage
  const tabs = nav.main.filter((i) => ["Calendar", "Chores", "Lists", "Meals"].includes(i.label))
  const more = {
    main: nav.main.filter((i) => !tabs.includes(i)),
    people: nav.people.filter(keep),
    settings: nav.settings.filter(keep),
  }
  const moreActive = [...more.main, ...more.people, ...more.settings].some((i) =>
    isActive(i, pathname),
  )

  return (
    <nav
      aria-label="Main"
      className="bg-background/95 z-30 flex flex-shrink-0 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      {tabs.map((i) => {
        const active = isActive(i, pathname)
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(TAB, active ? "text-primary" : "text-muted-foreground")}
          >
            <i.icon className="size-5" />
            {i.label}
          </Link>
        )
      })}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(TAB, "outline-none", moreActive ? "text-primary" : "text-muted-foreground")}
        >
          <EllipsisIcon className="size-5" />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-52">
          {more.main.map((i) => (
            <NavMenuItem key={i.href} item={i} pathname={pathname} />
          ))}
          {more.people.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs">People</DropdownMenuLabel>
              {more.people.map((i) => (
                <NavMenuItem key={i.href} item={i} pathname={pathname} />
              ))}
            </>
          )}
          {more.settings.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs">Settings</DropdownMenuLabel>
              {more.settings.map((i) => (
                <NavMenuItem key={i.href} item={i} pathname={pathname} />
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
