// Encode an uploaded file for the Magic Import endpoints (base64-in-JSON — the API proxy
// forwards JSON only). Images are downscaled to a sane max edge and re-encoded as JPEG so a
// multi-megapixel phone photo becomes a few hundred KB, staying well under the proxy's timeout
// without hurting OCR quality. PDFs are passed through as-is.

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.85

export interface EncodedFile {
  file_base64: string // raw base64, no data: prefix
  mime_type: string
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"))
    reader.readAsDataURL(file)
  })
}

function stripPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",")
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Could not load image"))
    img.src = src
  })
}

async function downscaleImage(file: File): Promise<EncodedFile> {
  const dataUrl = await readAsDataURL(file)
  let img: HTMLImageElement
  try {
    img = await loadImage(dataUrl)
  } catch {
    // Unreadable as an image — send the raw bytes and let the backend validate the mime.
    return { file_base64: stripPrefix(dataUrl), mime_type: file.type || "image/jpeg" }
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height) || 1)
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return { file_base64: stripPrefix(dataUrl), mime_type: file.type || "image/jpeg" }
  }
  ctx.drawImage(img, 0, 0, width, height)
  const out = canvas.toDataURL("image/jpeg", JPEG_QUALITY)
  return { file_base64: stripPrefix(out), mime_type: "image/jpeg" }
}

/** Encode a flyer/recipe upload: PDFs pass through, images are downscaled to JPEG. */
export async function encodeUpload(file: File): Promise<EncodedFile> {
  if (file.type === "application/pdf") {
    const dataUrl = await readAsDataURL(file)
    return { file_base64: stripPrefix(dataUrl), mime_type: "application/pdf" }
  }
  return downscaleImage(file)
}
