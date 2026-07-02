"use client"

import { use, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckIcon, GiftIcon, PencilIcon, PlusIcon, StarIcon, XIcon } from "lucide-react"

import { useApi } from "@/hooks/use-api"
import { useRealtime } from "@/hooks/use-realtime"
import {
  useCreateReward,
  useDecideRedemption,
  useDeleteReward,
  useRedeemReward,
  useRedemptions,
  useRewards,
  useStarBalances,
  useUpdateReward,
} from "@/hooks/use-rewards"
import { RewardSheet, type RewardFormValues } from "@/components/rewards/reward-sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { RewardOut, StarBalanceOut } from "@/lib/types/reward"

interface MembershipResponse {
  id: string
  family_id: string
  role: "owner" | "adult" | "child" | "viewer"
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

export default function RewardsPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params)
  const api = useApi()

  useRealtime(familyId)

  const { data: memberships = [] } = useQuery({
    queryKey: ["me", "memberships"],
    queryFn: () => api.get<MembershipResponse[]>("/me/memberships"),
  })
  const role = memberships.find((m) => m.family_id === familyId)?.role
  const canManage = role === "owner" || role === "adult"
  const canRedeem = !!role && role !== "viewer"

  const { data: rewards = [], isLoading: rewardsLoading } = useRewards(familyId)
  const { data: balances = [] } = useStarBalances(familyId)
  const { data: pending = [] } = useRedemptions(familyId, "pending")

  const createReward = useCreateReward(familyId)
  const updateReward = useUpdateReward(familyId)
  const deleteReward = useDeleteReward(familyId)
  const redeem = useRedeemReward(familyId)
  const decide = useDecideRedemption(familyId)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<RewardOut | undefined>()
  const [redeeming, setRedeeming] = useState<RewardOut | undefined>()

  // The shop hides inactive rewards from kids; managers still see them (muted).
  const shopRewards = canManage ? rewards : rewards.filter((r) => r.is_active)

  function openCreate() {
    setEditing(undefined)
    setSheetOpen(true)
  }
  function openEdit(reward: RewardOut) {
    setEditing(reward)
    setSheetOpen(true)
  }

  async function handleSubmit(values: RewardFormValues) {
    const data = {
      name: values.name.trim(),
      star_cost: values.star_cost,
      icon: values.icon?.trim() ? values.icon.trim() : null,
      description: values.description?.trim() ? values.description.trim() : null,
      is_active: values.is_active,
    }
    try {
      if (editing) {
        await updateReward.mutateAsync({ rewardId: editing.id, data })
        toast.success("Reward updated")
      } else {
        await createReward.mutateAsync(data)
        toast.success("Reward added")
      }
      setSheetOpen(false)
    } catch {
      toast.error("Couldn't save the reward. Please try again.")
    }
  }

  async function handleDelete() {
    if (!editing) return
    try {
      await deleteReward.mutateAsync(editing.id)
      toast.success("Reward deleted")
      setSheetOpen(false)
    } catch {
      toast.error("Couldn't delete the reward. Please try again.")
    }
  }

  function handleRedeem(balance: StarBalanceOut) {
    if (!redeeming) return
    redeem.mutate(
      { rewardId: redeeming.id, memberId: balance.member_id },
      {
        onSuccess: () => {
          toast.success(`🎉 ${balance.name} redeemed ${redeeming.name}! A parent will approve it.`)
          setRedeeming(undefined)
        },
        onError: (e) => toast.error((e as Error).message || "Couldn't redeem. Please try again."),
      },
    )
  }

  return (
    <div className="thin-scrollbar mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto p-4 sm:p-6 [&>*]:shrink-0">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Rewards</h1>
        <p className="text-muted-foreground text-sm">
          Earn ⭐ by finishing chores, then redeem them in the reward shop.
        </p>
      </header>

      {/* Star balances */}
      {balances.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            Star balances
          </h2>
          <div className="flex flex-wrap gap-2">
            {balances.map((b) => (
              <div
                key={b.member_id}
                className="bg-card ring-foreground/5 flex items-center gap-2.5 rounded-2xl p-2.5 pr-4 shadow-sm ring-1"
              >
                <span
                  className="flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: b.color }}
                >
                  {initials(b.name)}
                </span>
                <div>
                  <p className="text-sm font-medium leading-tight">{b.name}</p>
                  <p className="flex items-center gap-1 text-sm font-semibold text-amber-500">
                    <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
                    {b.available}
                    {b.pending > 0 && (
                      <span className="text-muted-foreground text-xs font-normal">
                        ({b.pending} held)
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pending approvals (parents) */}
      {canManage && pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            Awaiting approval · {pending.length}
          </h2>
          <ul className="flex flex-col gap-2">
            {pending.map((r) => (
              <li
                key={r.id}
                className="bg-card ring-foreground/5 flex items-center gap-3 rounded-2xl p-3 shadow-sm ring-1"
              >
                <span className="text-xl">{r.reward?.icon ?? "🎁"}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight">
                    {r.member?.name} · {r.reward?.name}
                  </p>
                  <p className="text-muted-foreground text-xs">{r.star_cost} ⭐</p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Approve"
                  className="text-emerald-600 hover:text-emerald-700"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate(
                      { redemptionId: r.id, approve: true },
                      {
                        onSuccess: () => toast.success("Approved 🎉"),
                        onError: () => toast.error("Couldn't approve. Please try again."),
                      },
                    )
                  }
                >
                  <CheckIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Reject"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate(
                      { redemptionId: r.id, approve: false },
                      {
                        onSuccess: () => toast.success("Redemption rejected — stars released"),
                        onError: () => toast.error("Couldn't reject. Please try again."),
                      },
                    )
                  }
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Reward shop */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            Reward shop
          </h2>
          {canManage && (
            <Button size="sm" onClick={openCreate}>
              <PlusIcon /> Add reward
            </Button>
          )}
        </div>

        {rewardsLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : shopRewards.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed py-12 text-center">
            <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
              <GiftIcon className="size-6" />
            </div>
            <div>
              <p className="font-medium">No rewards yet</p>
              <p className="text-muted-foreground text-sm">
                {canManage ? "Add a reward to start the star shop." : "Check back soon!"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {shopRewards.map((reward) => (
              <article
                key={reward.id}
                className={cn(
                  "bg-card ring-foreground/5 flex flex-col gap-2 rounded-2xl p-4 shadow-sm ring-1",
                  !reward.is_active && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between">
                  <span className="text-3xl">{reward.icon ?? "🎁"}</span>
                  {canManage && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${reward.name}`}
                      onClick={() => openEdit(reward)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <PencilIcon />
                    </Button>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{reward.name}</p>
                  {reward.description && (
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {reward.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="gap-1">
                    <StarIcon className="size-3 fill-amber-400 text-amber-400" />
                    {reward.star_cost}
                  </Badge>
                  {canRedeem && reward.is_active && (
                    <Button size="sm" variant="outline" onClick={() => setRedeeming(reward)}>
                      Redeem
                    </Button>
                  )}
                  {!reward.is_active && <span className="text-muted-foreground text-xs">Hidden</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <RewardSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSubmit={handleSubmit}
        onDelete={editing ? handleDelete : undefined}
        isPending={createReward.isPending || updateReward.isPending}
        isDeleting={deleteReward.isPending}
        editing={editing}
      />

      {/* Redeem: pick who's spending */}
      <Dialog open={!!redeeming} onOpenChange={(o) => !o && setRedeeming(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redeem {redeeming?.name}</DialogTitle>
            <DialogDescription>
              Costs {redeeming?.star_cost} ⭐ — who&apos;s redeeming?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {balances.length === 0 && (
              <p className="text-muted-foreground text-sm">No members have any stars yet.</p>
            )}
            {balances.map((b) => {
              const enough = b.available >= (redeeming?.star_cost ?? 0)
              return (
                <button
                  key={b.member_id}
                  type="button"
                  disabled={!enough || redeem.isPending}
                  onClick={() => handleRedeem(b)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                    enough ? "hover:bg-muted/50" : "cursor-not-allowed opacity-50",
                  )}
                >
                  <span
                    className="flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: b.color }}
                  >
                    {initials(b.name)}
                  </span>
                  <span className="flex-1 font-medium">{b.name}</span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-amber-500">
                    <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
                    {b.available}
                  </span>
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
