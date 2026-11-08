import { toast } from "sonner";
import { getApiToken } from "./api-auth";

/**
 * The API's own origin, for calling it directly from the browser. Empty means
 * "proxy only" (local dev, or a build without the variable). Inlined at build
 * time; the same variable the realtime stream uses.
 */
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(
  /\/$/,
  "",
);

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
  const method = (options.method ?? "GET").toUpperCase();
  const headers = {
    "content-type": "application/json",
    ...(options.headers ?? {}),
  };

  const viaProxy = () => fetch(`/api/backend/${path}`, { ...options, headers });

  // Straight to the API, skipping the Netlify function in between: that hop is a
  // billed invocation, a possible cold start (seconds), and a Clerk round trip
  // to mint a token, on every request. The browser's Clerk client keeps a token
  // fresh in the background, so here it is free. The proxy remains the fallback:
  // no base URL, no token, a 401, or a request that never connected (a CORS
  // refusal looks exactly like that from script) is re-sent through it, so a
  // misconfiguration degrades to the old behaviour instead of breaking the app.
  const direct = async (): Promise<Response | null> => {
    if (!API_BASE_URL) return null;
    const token = await getApiToken();
    if (!token) return null;
    try {
      const response = await fetch(`${API_BASE_URL}/${path}`, {
        ...options,
        headers: { ...headers, authorization: `Bearer ${token}` },
      });
      return response.status === 401 ? null : response;
    } catch (error) {
      // A throw is ambiguous: the request may never have left (CORS, DNS) or may
      // have landed with the response lost. Re-sending is only safe when doing it
      // twice is harmless, so POST/PATCH surface the failure rather than risk a
      // duplicate create; everything else falls back to the proxy.
      if (method === "POST" || method === "PATCH") throw error;
      return null;
    }
  };

  const response = (await direct()) ?? (await viaProxy());

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
