"use client"

import { useMemo } from "react"
import { makeApi } from "@/lib/api-client"

export function useApi() {
  return useMemo(() => makeApi(), [])
}
