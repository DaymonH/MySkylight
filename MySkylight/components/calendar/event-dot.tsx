import { cn } from "@/lib/utils"

interface EventDotProps {
  colors: string[]
  title: string
  large?: boolean
}

export function EventDot({ colors, title, large = false }: EventDotProps) {
  return (
    <div
      className={cn(
        "hover:bg-background/70 flex min-w-0 items-center rounded-md transition-colors",
        large ? "gap-1.5 px-1.5 py-1" : "gap-1 px-1 py-0.5",
      )}
    >
      <span className="flex flex-shrink-0 gap-0.5">
        {colors.slice(0, 3).map((c, i) => (
          <span
            key={i}
            className={cn("inline-block rounded-full", large ? "size-2.5" : "size-1.5")}
            style={{ backgroundColor: c }}
          />
        ))}
      </span>
      <span className={cn("truncate leading-tight", large ? "text-base" : "text-xs")}>{title}</span>
    </div>
  )
}
