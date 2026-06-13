import { NextResponse } from "next/server"

const API_BASE_URL = process.env.API_BASE_URL ?? ""

export async function POST(req: Request) {
  if (!API_BASE_URL) {
    return NextResponse.json({ error: "API_BASE_URL is not configured" }, { status: 500 })
  }

  const body = await req.arrayBuffer()
  const headers = new Headers()

  for (const key of ["svix-id", "svix-timestamp", "svix-signature", "content-type"]) {
    const val = req.headers.get(key)
    if (val) headers.set(key, val)
  }

  const res = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/v1/webhooks/clerk`, {
    method: "POST",
    headers,
    body,
  })

  const text = await res.text()
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  })
}
