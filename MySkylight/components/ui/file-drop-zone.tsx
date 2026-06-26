"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * A single-file picker that also accepts a **drag-dropped** file and an **image pasted** from the
 * clipboard (screenshots, copied photos). Tapping it opens the native file menu — and since it sets
 * no `capture`, phones offer the photo library *and* the camera instead of forcing the camera.
 *
 * `onFile` fires once per chosen/dropped/pasted file. Non-image clipboard pastes (e.g. a URL typed
 * into a nearby input) fall through untouched, so it composes safely with text fields in the dialog.
 */
export function FileDropZone({
  accept,
  onFile,
  disabled,
  className,
  children,
}: {
  accept: string
  onFile: (file: File) => void
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // Paste an image from the clipboard anywhere while this zone is mounted. We only claim the paste
  // (preventDefault) when it actually carries an image — text pastes are left alone.
  useEffect(() => {
    if (disabled) return
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            onFile(file)
            return
          }
        }
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [disabled, onFile])

  function pick(files: FileList | null) {
    const file = files?.[0]
    if (file) onFile(file)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = "" // let the same file be re-picked after an error
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-busy={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (!disabled) pick(e.dataTransfer.files)
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-input bg-input/30 p-6 text-center text-sm transition-colors outline-none",
          "hover:border-ring/60 hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
          dragging && "border-ring bg-accent",
          disabled && "pointer-events-none opacity-60",
          className
        )}
      >
        {children}
      </button>
    </>
  )
}
