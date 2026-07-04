"use client"

import { UtensilsCrossedIcon } from "lucide-react"

import { DeviceFamilyGate } from "@/components/device-family-gate"
import { MealBoard } from "@/components/meals/meal-board"

export default function DeviceMealsPage() {
  return (
    <DeviceFamilyGate icon={UtensilsCrossedIcon} label="Loading meals…">
      {(familyId) => (
        <div className="flex h-full w-full flex-col overflow-hidden">
          <MealBoard familyId={familyId} />
        </div>
      )}
    </DeviceFamilyGate>
  )
}
