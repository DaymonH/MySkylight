import { cn } from "@/lib/utils"

interface EventDotProps {
  colors: string[]
  title: string
  large?: boolean
}

export function EventDot({ colors, title, large = false }: EventDotProps) {
  return (
    <div className="hover:bg-background/70 flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 transition-colors">
      <span className="flex flex-shrink-0 gap-0.5">
        {colors.slice(0, 3).map((c, i) => (
          <span
            key={i}
            className={cn("inline-block rounded-full", large ? "size-2" : "size-1.5")}
            style={{ backgroundColor: c }}
          />
        ))}
      </span>
      <span className={cn("truncate leading-tight", large ? "text-sm" : "text-xs")}>{title}</span>
    </div>
  )
}
