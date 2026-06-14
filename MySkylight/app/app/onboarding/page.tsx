"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { CalendarDaysIcon, CheckCircle2Icon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const schema = z.object({
  name: z.string().min(1, "Family name is required").max(255),
})
type FormValues = z.infer<typeof schema>

interface FamilyOut {
  id: string
  name: string
}

export default function OnboardingPage() {
  const api = useApi()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<"family" | "done">("family")

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const createFamily = useMutation({
    mutationFn: (values: FormValues) => api.post<FamilyOut>("/families", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "memberships"] })
      toast.success("Family created!")
      setStep("done")
      setTimeout(() => router.push("/app"), 1500)
    },
    onError: () => toast.error("Couldn't create your family. Please try again."),
  })

  if (step === "done") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <CheckCircle2Icon className="text-primary size-12" />
        <p className="font-heading text-lg font-medium">Family created!</p>
        <p className="text-muted-foreground text-sm">Taking you home…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <span className="bg-primary text-primary-foreground mb-2 flex size-12 items-center justify-center rounded-2xl shadow-sm">
            <CalendarDaysIcon className="size-6" />
          </span>
          <CardTitle className="text-xl">Welcome to MySkylight</CardTitle>
          <CardDescription>Let&apos;s set up your family calendar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit((v) => createFamily.mutate(v))}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Family name</Label>
              <Input id="name" {...register("name")} placeholder="The Smith Family" autoFocus />
              {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
            </div>

            <Button type="submit" size="lg" disabled={createFamily.isPending}>
              {createFamily.isPending ? "Creating…" : "Create family"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
