"use client"

import { BookOpenIcon } from "lucide-react"

import { DeviceFamilyGate } from "@/components/device-family-gate"
import { RecipeBoard } from "@/components/meals/recipe-board"

export default function DeviceRecipesPage() {
  return (
    <DeviceFamilyGate icon={BookOpenIcon} label="Loading recipes…">
      {(familyId) => (
        <div className="flex h-full w-full flex-col overflow-hidden">
          <RecipeBoard familyId={familyId} />
        </div>
      )}
    </DeviceFamilyGate>
  )
}
