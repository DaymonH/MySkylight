"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { MenuIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { appNav, isActive, type NavItem } from "@/components/app-nav-items"
import { cn } from "@/lib/utils"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

/** The signed-in user's family + whether they can manage it (shared with the bottom bar). */
export function useFamilyNav() {
  const api = useApi()
  const { data: memberships } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const membership = memberships?.[0]
  if (!membership) return null
  const canManage = membership.role === "owner" || membership.role === "adult"
  return { familyId: membership.family_id, canManage, nav: appNav(membership.family_id) }
}

export function NavMenuItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(item, pathname)
  return (
    <DropdownMenuItem asChild className={cn(active && "bg-accent font-medium")}>
      <Link href={item.href} aria-current={active ? "page" : undefined}>
        <item.icon /> {item.label}
      </Link>
    </DropdownMenuItem>
  )
}

/** Header menu (tablet / desktop; phones use the bottom bar): every page, grouped. */
export function FamilyMenu() {
  const pathname = usePathname()
  const fam = useFamilyNav()
  if (!fam) return null
  const { canManage, nav } = fam
  const keep = (i: NavItem) => !i.adultOnly || canManage
  const people = nav.people.filter(keep)
  const settings = nav.settings.filter(keep)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Menu">
          <MenuIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {nav.main.map((i) => (
          <NavMenuItem key={i.href} item={i} pathname={pathname} />
        ))}
        {people.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs">People</DropdownMenuLabel>
            {people.map((i) => (
              <NavMenuItem key={i.href} item={i} pathname={pathname} />
            ))}
          </>
        )}
        {settings.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs">Settings</DropdownMenuLabel>
            {settings.map((i) => (
              <NavMenuItem key={i.href} item={i} pathname={pathname} />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
