"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { MEMBER_COLORS } from "@/lib/colors"
import { cn } from "@/lib/utils"

export interface EditableMember {
  id: string
  name: string
  color: string
  avatar_url: string | null
}

const schema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  avatar_url: z.string().url("Enter a valid URL").max(2048).optional().or(z.literal("")),
})
type FormValues = z.infer<typeof schema>

interface MemberEditSheetProps {
  familyId: string
  /** The member being edited, or `null` when the sheet is closed. */
  member: EditableMember | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Side sheet for editing a member's name, colour, and avatar (PATCH /members/{id}). */
export function MemberEditSheet({ familyId, member, open, onOpenChange }: MemberEditSheetProps) {
  const api = useApi()
  const qc = useQueryClient()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  // Re-seed the form each time a different member is opened.
  useEffect(() => {
    if (member) {
      reset({ name: member.name, color: member.color, avatar_url: member.avatar_url ?? "" })
    }
  }, [member, reset])

  const selectedColor = watch("color") ?? ""

  const updateMember = useMutation({
    mutationFn: (values: FormValues) => {
      if (!member) throw new Error("No member selected")
      return api.patch(`/families/${familyId}/members/${member.id}`, {
        name: values.name,
        color: values.color,
        avatar_url: values.avatar_url || null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", familyId] })
      toast.success("Member updated")
      onOpenChange(false)
    },
    onError: () => toast.error("Couldn't update member. Please try again."),
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit member</SheetTitle>
          <SheetDescription>Update how this person appears on the calendar.</SheetDescription>
        </SheetHeader>

        <form
          id="member-edit-form"
          onSubmit={handleSubmit((v) => updateMember.mutate(v))}
          className="thin-scrollbar flex flex-1 flex-col gap-5 overflow-y-auto px-6"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-member-name">Name</Label>
            <Input id="edit-member-name" {...register("name")} autoFocus />
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
                      selected && "ring-foreground ring-offset-background ring-2 ring-offset-2",
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {selected && <CheckIcon className="size-4 text-white" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-member-avatar">Avatar URL (optional)</Label>
            <Input
              id="edit-member-avatar"
              {...register("avatar_url")}
              placeholder="https://…"
              inputMode="url"
            />
            {errors.avatar_url && (
              <p className="text-destructive text-xs">{errors.avatar_url.message}</p>
            )}
          </div>
        </form>

        <SheetFooter>
          <Button type="submit" form="member-edit-form" disabled={updateMember.isPending}>
            {updateMember.isPending ? "Saving…" : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
