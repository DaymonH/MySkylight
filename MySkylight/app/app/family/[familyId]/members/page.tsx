"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"
import { Button } from "@/components/ui/button"
import { use } from "react"

const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#6366f1", "#a855f7", "#ec4899",
]

const schema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  is_child: z.boolean(),
  pin: z.string().regex(/^\d{4,8}$/).optional().or(z.literal("")),
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
    defaultValues: { color: "#6366f1", is_child: false },
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
      reset({ color: "#6366f1", is_child: false })
      setAdding(false)
    },
  })

  const deleteMember = useMutation({
    mutationFn: (id: string) => api.delete(`/families/${familyId}/members/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", familyId] }),
  })

  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold">Family Members</h1>
        <Button size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add Member"}
        </Button>
      </div>

      {adding && (
        <form
          onSubmit={handleSubmit((v) => addMember.mutate(v))}
          className="flex flex-col gap-4 rounded-xl border p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Name</label>
            <input
              {...register("name")}
              placeholder="Member name"
              className="border-input bg-background rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
            {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Color</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setValue("color", c)}
                  className="h-8 w-8 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    outline: selectedColor === c ? `3px solid ${c}` : "none",
                    outlineOffset: "2px",
                  }}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("is_child")} className="h-4 w-4" />
            Child profile
          </label>

          {isChild && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">PIN (4–8 digits, optional)</label>
              <input
                {...register("pin")}
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="••••"
                className="border-input bg-background rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          <Button type="submit" disabled={addMember.isPending}>
            {addMember.isPending ? "Adding…" : "Add Member"}
          </Button>
        </form>
      )}

      {isLoading ? (
        <p className="text-muted-foreground text-sm">Loading members…</p>
      ) : members.length === 0 ? (
        <p className="text-muted-foreground text-sm">No members yet. Add one above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div
                className="h-8 w-8 flex-shrink-0 rounded-full"
                style={{ backgroundColor: m.color }}
              />
              <div className="flex-1">
                <p className="text-sm font-medium">{m.name}</p>
                {m.is_child && (
                  <p className="text-muted-foreground text-xs">Child</p>
                )}
              </div>
              <button
                onClick={() => deleteMember.mutate(m.id)}
                className="text-muted-foreground hover:text-destructive text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
