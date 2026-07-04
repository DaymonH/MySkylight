"use client"

import { ListChecksIcon } from "lucide-react"

import { DeviceFamilyGate } from "@/components/device-family-gate"
import { ChoreBoard } from "@/components/tasks/chore-board"

export default function DeviceChoresPage() {
  return (
    <DeviceFamilyGate icon={ListChecksIcon} label="Loading chores…">
      {(familyId) => (
        <div className="flex h-full w-full flex-col overflow-hidden">
          <ChoreBoard familyId={familyId} />
        </div>
      )}
    </DeviceFamilyGate>
  )
}
