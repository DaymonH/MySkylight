/**
 * Minimal Server-Sent Events frame parser.
 *
 * `EventSource` would normally do this for us, but it can't send an
 * `Authorization` header — so the realtime stream is read with `fetch` instead
 * (see `hooks/use-realtime.ts`) and the framing becomes ours to handle.
 *
 * Network chunks have nothing to do with frame boundaries: one `read()` may
 * deliver several frames, half a frame, or a single byte. So text accumulates in
 * a buffer and only complete frames — those terminated by a blank line — are
 * emitted; the remainder waits for the rest to arrive.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = ""

  return {
    /** Feed one decoded chunk; emits every complete frame it completes. */
    push(chunk: string) {
      buffer += chunk
      let sep = buffer.indexOf("\n\n")
      while (sep !== -1) {
        emit(buffer.slice(0, sep))
        buffer = buffer.slice(sep + 2)
        sep = buffer.indexOf("\n\n")
      }
    },
  }

  function emit(frame: string) {
    // `data:` lines carry the payload and are concatenated when a frame has
    // several. Lines starting with `:` are comments — the backend's 25s
    // keepalive is one, and its only job is holding the connection open.
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("")
    if (data) onData(data)
  }
}
