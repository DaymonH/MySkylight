"use client"

import { useState } from "react"
import { toast } from "sonner"
import { GiftIcon, Loader2Icon, StarIcon } from "lucide-react"

import { useRealtime } from "@/hooks/use-realtime"
import { useRedeemReward, useRewards, useStarBalances } from "@/hooks/use-rewards"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { RewardOut, StarBalanceOut } from "@/lib/types/reward"

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?"
}

/**
 * The device "rewards" surface: glanceable per-member star balances and the
 * reward shop. Kids can redeem at the wall display (creates a pending request a
 * parent approves later in the companion app); other screens catch up over SSE.
 */
export function RewardBoard({ familyId }: { familyId: string }) {
  useRealtime(familyId)

  const { data: rewards = [], isLoading } = useRewards(familyId)
  const { data: balances = [] } = useStarBalances(familyId)
  const redeem = useRedeemReward(familyId)

  const [redeeming, setRedeeming] = useState<RewardOut | undefined>()
  const activeRewards = rewards.filter((r) => r.is_active)

  function handleRedeem(balance: StarBalanceOut) {
    if (!redeeming) return
    redeem.mutate(
      { rewardId: redeeming.id, memberId: balance.member_id },
      {
        onSuccess: () => {
          toast.success(`🎉 ${balance.name} redeemed ${redeeming.name}!`)
          setRedeeming(undefined)
        },
        onError: (e) => toast.error((e as Error).message || "Couldn't redeem."),
      },
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-5 py-3.5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <GiftIcon className="size-6" />
        </span>
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Rewards</h1>
          <p className="text-muted-foreground text-sm">Earn stars, redeem prizes</p>
        </div>
      </div>

      <div className="thin-scrollbar flex-1 overflow-auto p-5">
        {isLoading ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
            <Loader2Icon className="size-5 animate-spin" />
            Loading rewards…
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Balances */}
            {balances.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {balances.map((b) => (
                  <div
                    key={b.member_id}
                    className="bg-card ring-foreground/5 flex items-center gap-3 rounded-2xl p-3 pr-5 shadow-sm ring-1"
                  >
                    <span
                      className="flex size-12 items-center justify-center rounded-full text-lg font-semibold text-white"
                      style={{ backgroundColor: b.color }}
                    >
                      {initials(b.name)}
                    </span>
                    <div>
                      <p className="font-medium leading-tight">{b.name}</p>
                      <p className="flex items-center gap-1 text-xl font-bold text-amber-500">
                        <StarIcon className="size-5 fill-amber-400 text-amber-400" />
                        {b.available}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Shop */}
            {activeRewards.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <span className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-2xl">
                  <GiftIcon className="size-8" />
                </span>
                <p className="text-muted-foreground">No rewards in the shop yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {activeRewards.map((reward) => (
                  <button
                    key={reward.id}
                    type="button"
                    onClick={() => setRedeeming(reward)}
                    className="bg-card ring-foreground/5 flex flex-col items-center gap-2 rounded-3xl p-5 text-center shadow-sm ring-1 transition-colors hover:bg-muted/40 focus-visible:ring-ring/40 focus-visible:outline-none focus-visible:ring-2"
                  >
                    <span className="text-5xl">{reward.icon ?? "🎁"}</span>
                    <span className="font-semibold leading-tight">{reward.name}</span>
                    <span className="flex items-center gap-1 text-lg font-bold text-amber-500">
                      <StarIcon className="size-4 fill-amber-400 text-amber-400" />
                      {reward.star_cost}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Redeem: pick who's spending */}
      <Dialog open={!!redeeming} onOpenChange={(o) => !o && setRedeeming(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redeem {redeeming?.name}</DialogTitle>
            <DialogDescription>
              Costs {redeeming?.star_cost} ⭐ — tap your name to redeem.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {balances.map((b) => {
              const enough = b.available >= (redeeming?.star_cost ?? 0)
              return (
                <button
                  key={b.member_id}
                  type="button"
                  disabled={!enough || redeem.isPending}
                  onClick={() => handleRedeem(b)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors",
                    enough ? "hover:bg-muted/50" : "cursor-not-allowed opacity-50",
                  )}
                >
                  <span
                    className="flex size-11 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ backgroundColor: b.color }}
                  >
                    {initials(b.name)}
                  </span>
                  <span className="flex-1 text-lg font-medium">{b.name}</span>
                  <span className="flex items-center gap-1 font-semibold text-amber-500">
                    <StarIcon className="size-4 fill-amber-400 text-amber-400" />
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
