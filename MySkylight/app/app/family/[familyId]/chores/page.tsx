"use client"

import { use } from "react"

import { ChoresPanel } from "@/components/tasks/chores-panel"

export default function ChoresPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = use(params)
  return <ChoresPanel familyId={familyId} />
}
