"use client"

import { useState, use } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckIcon, Trash2Icon, UserPlusIcon, UsersIcon, XIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { MEMBER_COLORS } from "@/lib/colors"
import { cn } from "@/lib/utils"

const schema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  is_child: z.boolean(),
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits").optional().or(z.literal("")),
})
type FormValues = z.infer<typeof schema>

interface MemberOut {
  id: string
  name: string
  color: string
  is_child: boolean
  avatar_url: string | null
}

export default function MembersPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params)
  const api = useApi()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["members", familyId],
    queryFn: () => api.get<MemberOut[]>(`/families/${familyId}/members`),
  })

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { color: MEMBER_COLORS[0], is_child: false },
  })

  const selectedColor = watch("color")
  const isChild = watch("is_child")

  const addMember = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<MemberOut>(`/families/${familyId}/members`, {
        ...values,
        pin: values.pin || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", familyId] })
      reset({ color: MEMBER_COLORS[0], is_child: false })
      setAdding(false)
      toast.success("Member added")
    },
    onError: () => toast.error("Couldn't add member. Please try again."),
  })

  const deleteMember = useMutation({
    mutationFn: (id: string) => api.delete(`/families/${familyId}/members/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", familyId] })
      toast.success("Member removed")
    },
    onError: () => toast.error("Couldn't remove member. Please try again."),
  })

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-xl flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold tracking-tight">Family members</h1>
          <p className="text-muted-foreground text-sm">Everyone who shares this calendar.</p>
        </div>
        <Button size="sm" variant={adding ? "outline" : "default"} onClick={() => setAdding((v) => !v)}>
          {adding ? <><XIcon /> Cancel</> : <><UserPlusIcon /> Add</>}
        </Button>
      </div>

      {adding && (
        <Card>
          <CardContent>
            <form onSubmit={handleSubmit((v) => addMember.mutate(v))} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="member-name">Name</Label>
                <Input id="member-name" {...register("name")} placeholder="e.g. Mom, Jake" autoFocus />
                {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
              </div>

              <div className="flex flex-col gap-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2">
                  {MEMBER_COLORS.map((c) => {
                    const selected = selectedColor.toLowerCase() === c.toLowerCase()
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Color ${c}`}
                        aria-pressed={selected}
                        onClick={() => setValue("color", c)}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-full transition-transform hover:scale-110",
                          selected && "ring-foreground ring-2 ring-offset-2 ring-offset-background",
                        )}
                        style={{ backgroundColor: c }}
                      >
                        {selected && <CheckIcon className="size-4 text-white" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-muted/40 flex items-center justify-between rounded-2xl px-3.5 py-2.5">
                <div>
                  <Label htmlFor="is_child" className="cursor-pointer">Child profile</Label>
                  <p className="text-muted-foreground mt-0.5 text-xs">Optionally lock with a PIN.</p>
                </div>
                <Switch
                  id="is_child"
                  checked={isChild}
                  onCheckedChange={(v) => setValue("is_child", v)}
                />
              </div>

              {isChild && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pin">PIN (4–8 digits, optional)</Label>
                  <Input
                    id="pin"
                    {...register("pin")}
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="••••"
                  />
                  {errors.pin && <p className="text-destructive text-xs">{errors.pin.message}</p>}
                </div>
              )}

              <Button type="submit" disabled={addMember.isPending}>
                {addMember.isPending ? "Adding…" : "Add member"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border p-3">
              <Skeleton className="size-10 rounded-full" />
              <Skeleton className="h-4 w-32 rounded" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
            <UsersIcon className="size-6" />
          </div>
          <div>
            <p className="font-medium">No members yet</p>
            <p className="text-muted-foreground text-sm">Add your first family member to get started.</p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="bg-card ring-foreground/5 group flex items-center gap-3 rounded-2xl p-3 shadow-sm ring-1"
            >
              <Avatar size="lg">
                <AvatarFallback style={{ backgroundColor: m.color }} className="font-semibold text-white">
                  {m.name.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium leading-tight">{m.name}</p>
                {m.is_child && <Badge variant="secondary" className="mt-1">Child</Badge>}
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${m.name}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2Icon />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove {m.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      They&apos;ll be unassigned from all events. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => deleteMember.mutate(m.id)}>
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
