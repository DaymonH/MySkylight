"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  CalendarDaysIcon,
  ListChecksIcon,
  ListTodoIcon,
  MailPlusIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

/** Header menu linking to the family-management surfaces (members, invitations). */
export function FamilyMenu() {
  const api = useApi()
  const { data: memberships } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })

  const membership = memberships?.[0]
  if (!membership) return null

  const { family_id: familyId, role } = membership
  const canManage = role === "owner" || role === "adult"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Family menu">
          <UsersRoundIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Family</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/app">
            <CalendarDaysIcon /> Calendar
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/app/family/${familyId}/tasks`}>
            <ListChecksIcon /> Tasks &amp; chores
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/app/family/${familyId}/lists`}>
            <ListTodoIcon /> Lists &amp; groceries
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/app/family/${familyId}/members`}>
            <UsersIcon /> Members
          </Link>
        </DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`/app/family/${familyId}/invitations`}>
                <MailPlusIcon /> Invitations
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
