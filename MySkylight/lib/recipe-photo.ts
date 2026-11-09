import { isRemotePhoto } from "@/lib/media"

/**
 * A recipe saved with a photo URL from another site shouldn't keep hotlinking it: the server
 * copies it. So a remote `image_url` is pulled out of the save payload (the create/update goes
 * through without it) and handed back to be saved afterwards via the "set photo" endpoint.
 * Local photos and blank values pass through untouched.
 */
export function splitRemotePhoto<T extends { image_url?: string | null }>(
  payload: T,
): { payload: T; remote: string | null } {
  const url = payload.image_url?.trim() ?? null
  if (!isRemotePhoto(url)) return { payload, remote: null }
  const rest = { ...payload }
  delete rest.image_url
  return { payload: rest, remote: url }
}
