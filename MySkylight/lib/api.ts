import { toast } from "sonner";

export type ApiResult<T> = {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
};

// Throttle so a burst of 429s (e.g. an auto-effect retrying) only surfaces
// one toast instead of stacking duplicates on the user.
let lastRateLimitToastAt = 0;
const RATE_LIMIT_TOAST_COOLDOWN_MS = 3000;

function notifyRateLimited(message: string, retryAfterSeconds?: number) {
  const now = Date.now();
  if (now - lastRateLimitToastAt < RATE_LIMIT_TOAST_COOLDOWN_MS) return;
  lastRateLimitToastAt = now;
  const description = retryAfterSeconds
    ? `Try again in ${retryAfterSeconds}s.`
    : "Please slow down and try again in a moment.";
  toast.error(message, { description });
}

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
    // FastAPI/slowapi surface error text under `detail`; older handlers may use `error`.
    const message =
      typeof errorBody === "string"
        ? errorBody
        : (errorBody?.detail ?? errorBody?.error);

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
      notifyRateLimited(
        message || "Rate limit exceeded",
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }

    return {
      ok: false,
      status: response.status,
      error: message,
    };
  }

  const data = isJson ? await response.json() : undefined;
  return { ok: true, status: response.status, data };
}
