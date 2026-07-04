"use client"

import { ListTodoIcon } from "lucide-react"

import { DeviceFamilyGate } from "@/components/device-family-gate"
import { ListBoard } from "@/components/lists/list-board"

export default function DeviceListsPage() {
  return (
    <DeviceFamilyGate icon={ListTodoIcon} label="Loading lists…">
      {(familyId) => (
        <div className="flex h-full w-full flex-col overflow-hidden">
          <ListBoard familyId={familyId} />
        </div>
      )}
    </DeviceFamilyGate>
  )
}
