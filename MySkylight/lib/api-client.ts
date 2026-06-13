const API_PREFIX = "/api/backend/api/v1"

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, ...rest } = options

  const res = await fetch(`${API_PREFIX}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(rest.headers ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export function makeApi() {
  return {
    get: <T>(path: string, init?: RequestOptions) =>
      request<T>(path, { method: "GET", ...init }),
    post: <T>(path: string, body?: unknown, init?: RequestOptions) =>
      request<T>(path, { method: "POST", body, ...init }),
    patch: <T>(path: string, body?: unknown, init?: RequestOptions) =>
      request<T>(path, { method: "PATCH", body, ...init }),
    delete: <T>(path: string, init?: RequestOptions) =>
      request<T>(path, { method: "DELETE", ...init }),
  }
}
