"use client"

import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
import type { RewardOut } from "@/lib/types/reward"

const schema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  star_cost: z.number().int().min(1, "At least 1 star").max(9999),
  icon: z.string().max(16).optional(),
  description: z.string().optional(),
  is_active: z.boolean(),
})
export type RewardFormValues = z.infer<typeof schema>

interface RewardSheetProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: RewardFormValues) => void
  onDelete?: () => void
  isPending: boolean
  isDeleting?: boolean
  editing?: RewardOut
}

export function RewardSheet({
  open,
  onClose,
  onSubmit,
  onDelete,
  isPending,
  isDeleting,
  editing,
}: RewardSheetProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<RewardFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", star_cost: 5, icon: "", description: "", is_active: true },
  })

  useEffect(() => {
    if (!open) return
    reset(
      editing
        ? {
            name: editing.name,
            star_cost: editing.star_cost,
            icon: editing.icon ?? "",
            description: editing.description ?? "",
            is_active: editing.is_active,
          }
        : { name: "", star_cost: 5, icon: "", description: "", is_active: true },
    )
  }, [open, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg">{editing ? "Edit reward" : "New reward"}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="thin-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
            <div className="space-y-1.5">
              <Label htmlFor="reward-name">Name</Label>
              <Input id="reward-name" {...register("name")} placeholder="e.g. Ice cream trip" />
              {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="reward-cost">Star cost ⭐</Label>
                <Input
                  id="reward-cost"
                  type="number"
                  min={1}
                  max={9999}
                  {...register("star_cost", { valueAsNumber: true })}
                />
                {errors.star_cost && (
                  <p className="text-destructive text-xs">{errors.star_cost.message}</p>
                )}
              </div>
              <div className="w-24 space-y-1.5">
                <Label htmlFor="reward-icon">Icon</Label>
                <Input id="reward-icon" {...register("icon")} placeholder="🍦" className="text-center" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reward-desc">Description</Label>
              <Textarea
                id="reward-desc"
                {...register("description")}
                placeholder="Optional details"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div>
                <p className="text-sm font-medium">Available in the shop</p>
                <p className="text-muted-foreground text-xs">Turn off to hide without deleting.</p>
              </div>
              <Controller
                name="is_active"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="Available in the shop"
                  />
                )}
              />
            </div>
          </div>

          <SheetFooter className="flex-row items-center gap-2 border-t">
            {onDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" size="icon" aria-label="Delete reward">
                    <Trash2Icon />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this reward?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes it from the shop. Past redemptions are kept.
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
              {isPending ? "Saving…" : editing ? "Save changes" : "Create reward"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
