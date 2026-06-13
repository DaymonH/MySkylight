"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"

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
  const [step, setStep] = useState<"family" | "done">("family")

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  const createFamily = useMutation({
    mutationFn: (values: FormValues) => api.post<FamilyOut>("/families", values),
    onSuccess: () => {
      setStep("done")
      setTimeout(() => router.push("/app"), 1500)
    },
  })

  if (step === "done") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-lg">Family created! Taking you home…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="font-heading text-3xl font-bold">Welcome to MySkylight</h1>
        <p className="text-muted-foreground mt-2">Let's set up your family calendar.</p>
      </div>

      <form
        onSubmit={handleSubmit((v) => createFamily.mutate(v))}
        className="flex w-full max-w-sm flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium">
            Family name
          </label>
          <input
            id="name"
            {...register("name")}
            placeholder="The Smith Family"
            className="border-input bg-background rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
        </div>

        <Button type="submit" disabled={createFamily.isPending}>
          {createFamily.isPending ? "Creating…" : "Create Family"}
        </Button>

        {createFamily.isError && (
          <p className="text-destructive text-sm">
            Something went wrong. Please try again.
          </p>
        )}
      </form>
    </div>
  )
}
