"use client"

import { useState, use, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CheckIcon, ClockIcon, CopyIcon, MailPlusIcon, MailIcon, ShieldAlertIcon, Trash2Icon, XIcon,
} from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

// Roles a family can be invited with. `owner` is intentionally excluded — the
// owner is whoever created the family; you don't invite a second one.
const INVITE_ROLES = ["adult", "child", "viewer"] as const
type InviteRole = (typeof INVITE_ROLES)[number]

const ROLE_LABELS: Record<InviteRole, string> = {
  adult: "Adult",
  child: "Child",
  viewer: "Viewer",
}

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  role: z.enum(INVITE_ROLES),
})
type FormValues = z.infer<typeof schema>

interface InvitationOut {
  id: string
  family_id: string
  email: string
  role: InviteRole | "owner"
  status: "pending" | "accepted" | "revoked"
  token: string
  expires_at: string
  created_at: string
}

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

export default function InvitationsPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params)
  const api = useApi()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // Bring the invite form into view when it opens so its button isn't below the fold.
  const addFormRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (adding) {
      addFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [adding])

  // Mirror the backend guard (FamilyOwnerOrAdult): only owner/adult manage invites.
  const { data: memberships } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const myRole = memberships?.find((m) => m.family_id === familyId)?.role
  const canManage = myRole === "owner" || myRole === "adult"

  const { data: invitations = [], isLoading } = useQuery({
    queryKey: ["invitations", familyId],
    queryFn: () => api.get<InvitationOut[]>(`/families/${familyId}/invitations`),
    enabled: canManage,
  })

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: "adult" },
  })
  const role = watch("role")

  const sendInvite = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<InvitationOut>(`/families/${familyId}/invitations`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invitations", familyId] })
      reset({ role: "adult", email: "" })
      setAdding(false)
      toast.success("Invitation created — copy the link to share it")
    },
    onError: (err: unknown) => {
      const status = (err as { status?: number })?.status
      toast.error(
        status === 409
          ? "There's already a pending invite for that email."
          : "Couldn't create the invitation. Please try again.",
      )
    },
  })

  const revokeInvite = useMutation({
    mutationFn: (id: string) => api.delete(`/families/${familyId}/invitations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invitations", familyId] })
      toast.success("Invitation revoked")
    },
    onError: () => toast.error("Couldn't revoke the invitation. Please try again."),
  })

  async function copyLink(inv: InvitationOut) {
    const url = `${window.location.origin}/invite/accept?token=${encodeURIComponent(inv.token)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(inv.id)
      setTimeout(() => setCopiedId((c) => (c === inv.id ? null : c)), 2000)
      toast.success("Invite link copied")
    } catch {
      toast.error("Couldn't copy. Long-press the field to copy manually.")
    }
  }

  if (memberships && !canManage) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3 p-6 pt-16 text-center">
        <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
          <ShieldAlertIcon className="size-6" />
        </div>
        <div>
          <p className="font-medium">Invitations are managed by adults</p>
          <p className="text-muted-foreground text-sm">
            Ask a family owner or adult to invite new members.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-xl flex-col gap-6 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight">Invitations</h1>
          <p className="text-muted-foreground text-sm">Invite people to share this calendar.</p>
        </div>
        <Button size="sm" variant={adding ? "outline" : "default"} onClick={() => setAdding((v) => !v)}>
          {adding ? <><XIcon /> Cancel</> : <><MailPlusIcon /> Invite</>}
        </Button>
      </div>

      {adding && (
        <Card ref={addFormRef} className="scroll-mt-4">
          <CardContent>
            <form onSubmit={handleSubmit((v) => sendInvite.mutate(v))} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  inputMode="email"
                  {...register("email")}
                  placeholder="name@example.com"
                  autoFocus
                />
                {errors.email && <p className="text-destructive text-xs">{errors.email.message}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={role} onValueChange={(v) => setValue("role", v as InviteRole)}>
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" disabled={sendInvite.isPending}>
                {sendInvite.isPending ? "Creating…" : "Create invitation"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border p-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 w-40 rounded" />
            </div>
          ))}
        </div>
      ) : invitations.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
            <MailIcon className="size-6" />
          </div>
          <div>
            <p className="font-medium">No pending invitations</p>
            <p className="text-muted-foreground text-sm">
              Invite someone, then share the link with them.
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {invitations.map((inv) => {
            const days = daysUntil(inv.expires_at)
            const copied = copiedId === inv.id
            return (
              <li
                key={inv.id}
                className="bg-card ring-foreground/5 flex flex-col gap-3 rounded-2xl p-3 shadow-sm ring-1"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
                    <MailIcon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium leading-tight">{inv.email}</p>
                    <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                      <Badge variant="secondary">{ROLE_LABELS[inv.role as InviteRole] ?? inv.role}</Badge>
                      <span className="flex items-center gap-1">
                        <ClockIcon className="size-3" />
                        {days <= 0 ? "Expired" : `Expires in ${days} day${days === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Revoke invitation for ${inv.email}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2Icon />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The link sent to {inv.email} will stop working. This can&apos;t be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => revokeInvite.mutate(inv.id)}>
                          Revoke
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => copyLink(inv)}
                  disabled={days <= 0}
                >
                  {copied ? <><CheckIcon /> Copied!</> : <><CopyIcon /> Copy invite link</>}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
