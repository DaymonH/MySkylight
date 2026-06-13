"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "./api";

export function useApiQuery<T>(path: string, options?: RequestInit) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // options excluded from deps — pass a stable reference or omit for plain GETs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiRequest<T>(path, options)
      .then((result) => {
        if (result.ok && result.data !== undefined) {
          setData(result.data);
        } else {
          setError(result.error ?? "Request failed");
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Request failed");
      })
      .finally(() => setLoading(false));
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refetch: load };
}
