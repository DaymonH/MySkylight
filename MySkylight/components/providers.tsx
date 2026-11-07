"use client"

import { QueryClient } from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { useState } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { PwaRegister } from "@/components/pwa-register"
import { ApiAuthBridge } from "@/components/api-auth-bridge"
import {
  PERSIST_BUSTER,
  PERSIST_MAX_AGE_MS,
  createQueryPersister,
} from "@/lib/query-persist"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Must be >= the persister's maxAge or garbage collection discards
            // the stored cache before it can be restored.
            gcTime: PERSIST_MAX_AGE_MS,
            retry: 1,
          },
        },
      }),
  )

  const [persister] = useState(createQueryPersister)

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE_MS,
        buster: PERSIST_BUSTER,
      }}
    >
      <ThemeProvider>{children}</ThemeProvider>
      <ApiAuthBridge />
      <PwaRegister />
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools />}
    </PersistQueryClientProvider>
  )
}
