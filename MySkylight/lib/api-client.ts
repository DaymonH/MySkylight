import { apiRequest } from "@/lib/api"

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown }

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * A *definitive* client-side failure (bad request / unauthorized / forbidden /
 * not found / conflict) — the request reached the backend and was rejected, so it
 * will never succeed as-is. Distinct from an ambiguous transport error (a dropped
 * connection, timeout, or 5xx from our proxy) where an *idempotent* write may well
 * have landed even though the response didn't make it back. `429` is excluded —
 * that's "slow down", which is worth retrying.
 */
export function isDefiniteClientError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  )
}

/**
 * Whether a failed *idempotent* request is worth retrying: transport-level
 * flakiness — a network throw, a rate-limit (429), or a 5xx (incl. the proxy's
 * 502/504 on a reset/timeout over the home link). Never retry a 4xx: the backend
 * saw it and said no. Safe only for idempotent writes (PUT/DELETE to a fixed key).
 */
export function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500 || error.status === 429
  // A non-ApiError here means `fetch` itself threw (DNS, connection reset,
  // abort) before any HTTP status — transient by nature.
  return true
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, ...rest } = options
  const result = await apiRequest<T>(`api/v1${path}`, {
    ...rest,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!result.ok) {
    throw new ApiError(result.status, result.error ?? "Request failed")
  }
  return result.data as T
}

export function makeApi() {
  return {
    get: <T>(path: string, init?: RequestOptions) =>
      request<T>(path, { method: "GET", ...init }),
    post: <T>(path: string, body?: unknown, init?: RequestOptions) =>
      request<T>(path, { method: "POST", body, ...init }),
    put: <T>(path: string, body?: unknown, init?: RequestOptions) =>
      request<T>(path, { method: "PUT", body, ...init }),
    patch: <T>(path: string, body?: unknown, init?: RequestOptions) =>
      request<T>(path, { method: "PATCH", body, ...init }),
    delete: <T>(path: string, init?: RequestOptions) =>
      request<T>(path, { method: "DELETE", ...init }),
  }
}
