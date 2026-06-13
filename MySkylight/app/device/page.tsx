"use client"

import { useUser } from "@clerk/nextjs"

export default function DevicePage() {
  const { user } = useUser()

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="font-heading text-5xl font-bold tracking-tight">MySkylight</h1>
        <p className="text-muted-foreground mt-2 text-xl">Family Calendar</p>
      </div>

      {user && (
        <p className="text-muted-foreground text-lg">
          Welcome, {user.firstName ?? user.emailAddresses[0]?.emailAddress}
        </p>
      )}

      <div className="text-muted-foreground rounded-xl border border-dashed p-12 text-center text-sm">
        Calendar view coming in Phase 2
      </div>
    </div>
  )
}
