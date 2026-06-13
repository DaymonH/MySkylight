interface EventDotProps {
  colors: string[]
  title: string
}

export function EventDot({ colors, title }: EventDotProps) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="flex flex-shrink-0 gap-0.5">
        {colors.slice(0, 3).map((c, i) => (
          <span key={i} className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
        ))}
      </div>
      <span className="truncate text-xs leading-tight">{title}</span>
    </div>
  )
}
