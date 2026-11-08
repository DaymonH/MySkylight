import {
  BellIcon,
  BrushCleaningIcon,
  CalendarDaysIcon,
  CalendarSyncIcon,
  GiftIcon,
  ListIcon,
  MailPlusIcon,
  UsersIcon,
  UtensilsCrossedIcon,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Pathname prefixes that count as "on this page" (the item's own href is always one). */
  match?: string[]
  adultOnly?: boolean
}

/**
 * The companion app's navigation, in one place so the header menu and the phone
 * bottom bar can't drift apart. `main` are the everyday pages, `people` is who's in
 * the family, `settings` is housekeeping.
 */
export function appNav(familyId: string): {
  main: NavItem[]
  people: NavItem[]
  settings: NavItem[]
} {
  const f = `/app/family/${familyId}`
  return {
    main: [
      { label: "Calendar", href: "/app", icon: CalendarDaysIcon, match: ["/app"] },
      {
        label: "Chores",
        href: `${f}/chores`,
        icon: BrushCleaningIcon,
        match: [`${f}/chores`, `${f}/tasks`],
      },
      { label: "Lists", href: `${f}/lists`, icon: ListIcon },
      { label: "Meals", href: `${f}/meals`, icon: UtensilsCrossedIcon },
      { label: "Rewards", href: `${f}/rewards`, icon: GiftIcon },
    ],
    people: [
      { label: "Members", href: `${f}/members`, icon: UsersIcon },
      { label: "Invitations", href: `${f}/invitations`, icon: MailPlusIcon, adultOnly: true },
    ],
    settings: [
      { label: "Notifications", href: `${f}/notifications`, icon: BellIcon },
      { label: "Calendar sync", href: `${f}/integrations`, icon: CalendarSyncIcon, adultOnly: true },
    ],
  }
}

/** True when `pathname` is this item's page (Calendar is `/app` exactly). */
export function isActive(item: NavItem, pathname: string): boolean {
  const roots = item.match ?? [item.href]
  return roots.some((r) =>
    r === "/app" ? pathname === "/app" : pathname === r || pathname.startsWith(`${r}/`),
  )
}
