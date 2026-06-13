import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL ?? "";
const PROXY_TIMEOUT_MS = 20_000;

function isTransientNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toUpperCase();
  return (
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("UND_ERR_SOCKET") ||
    message.includes("UND_ERR_CONNECT_TIMEOUT") ||
    message.includes("ETIMEDOUT") ||
    message.includes("EAI_AGAIN") ||
    message.includes("FETCH FAILED")
  );
}

async function fetchWithTimeout(
  input: URL,
  init: RequestInit & { duplex?: "half" },
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildTargetUrl(pathSegments: string[], requestUrl: URL) {
  const normalizedBase = API_BASE_URL.replace(/\/$/, "");
  const targetPath = pathSegments.join("/");
  const targetUrl = new URL(`${normalizedBase}/${targetPath}`);
  targetUrl.search = requestUrl.search;
  return targetUrl;
}

async function proxyRequest(
  req: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  if (!API_BASE_URL) {
    return NextResponse.json(
      { error: "API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  const { path: pathSegments = [] } = await context.params;
  const isHealth = pathSegments.join("/") === "api/v1/health";

  const headers = new Headers(req.headers);
  headers.delete("host");

  const hasAuthHeader = Boolean(headers.get("authorization"));

  if (!isHealth && !hasAuthHeader) {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const template =
      process.env.CLERK_JWT_TEMPLATE ??
      process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE;
    const token = await getToken(template ? { template } : undefined);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    headers.set("authorization", `Bearer ${token}`);
  }

  const targetUrl = buildTargetUrl(pathSegments, new URL(req.url));

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
    redirect: "manual",
  };

  const RETRY_BACKOFF_MS = [200, 500];
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      response = await fetchWithTimeout(targetUrl, init, PROXY_TIMEOUT_MS);
      break;
    } catch (error) {
      lastError = error;
      if (
        attempt === RETRY_BACKOFF_MS.length ||
        !isTransientNetworkError(error)
      ) {
        const message =
          error instanceof Error ? error.message : "Unknown proxy error";
        return NextResponse.json(
          {
            error: isTransientNetworkError(error)
              ? "Backend unavailable"
              : "Backend request failed",
            detail: message,
            target: targetUrl.toString(),
          },
          { status: 502 },
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BACKOFF_MS[attempt]),
      );
    }
  }

  if (!response) {
    const message =
      lastError instanceof Error ? lastError.message : "Unknown proxy error";
    return NextResponse.json(
      { error: "Backend request failed", detail: message },
      { status: 502 },
    );
  }

  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, context: RouteContext) {
  return proxyRequest(req, context);
}

export async function POST(req: Request, context: RouteContext) {
  return proxyRequest(req, context);
}

export async function PUT(req: Request, context: RouteContext) {
  return proxyRequest(req, context);
}

export async function DELETE(req: Request, context: RouteContext) {
  return proxyRequest(req, context);
}
