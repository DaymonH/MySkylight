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
    patch: <T>(path: string, body?: unknown, init?: RequestOptions) =>
      request<T>(path, { method: "PATCH", body, ...init }),
    delete: <T>(path: string, init?: RequestOptions) =>
      request<T>(path, { method: "DELETE", ...init }),
  }
}
