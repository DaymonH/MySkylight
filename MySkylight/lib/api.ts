export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`/api/backend/${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    const errorBody = isJson ? await response.json() : await response.text();
    const message =
      typeof errorBody === "string"
        ? errorBody
        : (errorBody?.detail ?? errorBody?.error);

    return {
      ok: false,
      status: response.status,
      error: message,
    };
  }

  const data = isJson ? await response.json() : undefined;
  return { ok: true, status: response.status, data };
}
