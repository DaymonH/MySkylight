const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "")

/**
 * Browser-loadable URL for an image. Recipe photos saved on our server come back as
 * `/api/v1/media/...` (relative to the API), so they need the API's origin; photos that are
 * still hotlinked from another site are already absolute and pass through. With no API base
 * configured (local dev) they go through the Next proxy instead.
 */
export function mediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (!url.startsWith("/api/")) return url
  return API_BASE_URL
    ? `${API_BASE_URL}${url}`
    : url.replace(/^\/api\/v1\//, "/api/backend/")
}

/** True for a photo we host ourselves (vs. a remote URL we should still copy). */
export function isLocalPhoto(url: string | null | undefined): boolean {
  return !!url && url.startsWith("/api/")
}

/** True for an http(s) URL on another site. */
export function isRemotePhoto(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url.trim())
}
