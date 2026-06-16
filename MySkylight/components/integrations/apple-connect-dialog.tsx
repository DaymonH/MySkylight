"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2Icon } from "lucide-react"

import { useConnectApple } from "@/hooks/use-external-calendars"
import { ApiError } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const schema = z.object({
  apple_id: z.string().min(3, "Enter your Apple ID email"),
  // Apple app-specific passwords are formatted xxxx-xxxx-xxxx-xxxx (16 + 3 dashes).
  app_password: z.string().min(1, "Enter an app-specific password"),
})
type FormValues = z.infer<typeof schema>

/**
 * Connect an iCloud account for read-only calendar sync (F20). iCloud has no
 * OAuth, so we take the Apple ID and an app-specific password (generated at
 * appleid.apple.com) and validate them by discovering the account's calendars
 * over CalDAV. The password is stored server-side; it's never shown again.
 */
export function AppleConnectDialog({
  familyId,
  open,
  onOpenChange,
}: {
  familyId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const connect = useConnectApple(familyId)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (open) reset({ apple_id: "", app_password: "" })
  }, [open, reset])

  function onSubmit(values: FormValues) {
    connect.mutate(
      // Apple shows the password with dashes; the CalDAV server accepts it either
      // way, but strip incidental whitespace the user may paste in.
      { apple_id: values.apple_id.trim(), app_password: values.app_password.trim() },
      {
        onSuccess: (account) => {
          toast.success(
            `Connected iCloud — found ${account.calendars.length} calendar${
              account.calendars.length === 1 ? "" : "s"
            }`,
          )
          onOpenChange(false)
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 401) {
            toast.error("Apple ID or app-specific password was rejected.")
          } else if (e instanceof ApiError && e.status === 502) {
            toast.error("Couldn't reach iCloud. Please try again in a moment.")
          } else {
            toast.error("Couldn't connect iCloud. Please try again.")
          }
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect iCloud</DialogTitle>
          <DialogDescription>
            Apple Calendar syncs read-only. Use an{" "}
            <a
              href="https://appleid.apple.com/account/manage"
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
            >
              app-specific password
            </a>{" "}
            (Sign-In &amp; Security → App-Specific Passwords) — not your normal
            Apple password.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="apple_id">Apple ID</Label>
            <Input
              id="apple_id"
              type="email"
              autoComplete="username"
              placeholder="you@icloud.com"
              {...register("apple_id")}
            />
            {errors.apple_id && (
              <p className="text-destructive text-xs">{errors.apple_id.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app_password">App-specific password</Label>
            <Input
              id="app_password"
              type="password"
              autoComplete="off"
              placeholder="xxxx-xxxx-xxxx-xxxx"
              {...register("app_password")}
            />
            {errors.app_password && (
              <p className="text-destructive text-xs">
                {errors.app_password.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={connect.isPending}>
              {connect.isPending && <Loader2Icon className="animate-spin" />}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
