"use client"

import { GiftIcon } from "lucide-react"

import { DeviceFamilyGate } from "@/components/device-family-gate"
import { RewardBoard } from "@/components/rewards/reward-board"

export default function DeviceRewardsPage() {
  return (
    <DeviceFamilyGate icon={GiftIcon} label="Loading rewards…">
      {(familyId) => (
        <div className="flex h-full w-full flex-col overflow-hidden">
          <RewardBoard familyId={familyId} />
        </div>
      )}
    </DeviceFamilyGate>
  )
}
