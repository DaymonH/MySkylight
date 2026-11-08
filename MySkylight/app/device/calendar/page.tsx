"use client"

import { CalendarDaysIcon } from "lucide-react"

import { DeviceFamilyGate } from "@/components/device-family-gate"
import { CalendarView } from "@/components/calendar/calendar-view"

export default function DeviceCalendarPage() {
  return (
    <DeviceFamilyGate icon={CalendarDaysIcon} label="Loading your calendar…">
      {(familyId) => (
        <div className="flex h-full w-full flex-col overflow-hidden">
          <CalendarView
            familyId={familyId}
            defaultView="week"
            storageKey="skylight:view:device"
            surface="device"
          />
        </div>
      )}
    </DeviceFamilyGate>
  )
}
