"use client"

import { SunIcon } from "lucide-react"

import { DeviceFamilyGate } from "@/components/device-family-gate"
import { TodayScreen } from "@/components/today/today-screen"

/** The wall display's landing screen (the kiosk's home-screen shortcut opens here). */
export default function DevicePage() {
  return (
    <DeviceFamilyGate icon={SunIcon} label="Loading your day…">
      {(familyId) => <TodayScreen familyId={familyId} />}
    </DeviceFamilyGate>
  )
}
