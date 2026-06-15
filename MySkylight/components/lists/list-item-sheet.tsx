"use client"

import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { MemberBrief } from "@/lib/types/calendar"
import type { ListItemOut } from "@/lib/types/list"

export const NO_ASSIGNEE = "none"

const schema = z.object({
  text: z.string().min(1, "Required").max(500),
  quantity: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  assignee_member_id: z.string(),
})
export type ListItemFormValues = z.infer<typeof schema>

interface ListItemSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: ListItemFormValues) => void
  onDelete?: () => void
  isPending: boolean
  isDeleting?: boolean
  members: MemberBrief[]
  editing?: ListItemOut
  /** Show the quantity field (grocery lists). */
  showQuantity?: boolean
}

export function ListItemSheet({
  open,
  onClose,
  onSubmit,
  onDelete,
  isPending,
  isDeleting,
  members,
  editing,
  showQuantity,
}: ListItemSheetProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<ListItemFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { text: "", quantity: "", category: "", assignee_member_id: NO_ASSIGNEE },
  })

  useEffect(() => {
    if (!open) return
    reset(
      editing
        ? {
            text: editing.text,
            quantity: editing.quantity ?? "",
            category: editing.category ?? "",
            assignee_member_id: editing.assignee?.id ?? NO_ASSIGNEE,
          }
        : { text: "", quantity: "", category: "", assignee_member_id: NO_ASSIGNEE },
    )
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg">{editing ? "Edit item" : "New item"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
            <div className="space-y-1.5">
              <Label htmlFor="item-text">Item</Label>
              <Input id="item-text" {...register("text")} placeholder="e.g. Milk" />
              {errors.text && <p className="text-destructive text-xs">{errors.text.message}</p>}
            </div>

            {showQuantity && (
              <div className="space-y-1.5">
                <Label htmlFor="item-qty">Quantity</Label>
                <Input id="item-qty" {...register("quantity")} placeholder="e.g. 2 lbs, a dozen" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="item-category">Category</Label>
              <Input
                id="item-category"
                {...register("category")}
                placeholder={showQuantity ? "e.g. Produce, Dairy" : "e.g. Errands"}
              />
            </div>

            {members.length > 0 && (
              <div className="space-y-1.5">
                <Label>Assign to</Label>
                <Controller
                  name="assignee_member_id"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ASSIGNEE}>Unassigned</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            )}
          </div>

          <SheetFooter className="flex-row items-center gap-2 border-t">
            {onDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="icon" aria-label="Delete item">
                    <Trash2Icon />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this item?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the item from the list for everyone in the family.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={onDelete} disabled={isDeleting}>
                      {isDeleting ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
