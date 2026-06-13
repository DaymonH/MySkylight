interface WeatherIconProps {
  code: number
  maxTemp: number
  minTemp: number
  compact?: boolean
}

function wmoEmoji(code: number): string {
  if (code === 0) return "☀️"
  if (code <= 2) return "🌤️"
  if (code === 3) return "☁️"
  if (code <= 48) return "🌫️"
  if (code <= 67) return "🌧️"
  if (code <= 77) return "❄️"
  if (code <= 82) return "🌦️"
  if (code <= 86) return "❄️"
  return "⛈️"
}

export function WeatherIcon({ code, maxTemp, minTemp, compact = false }: WeatherIconProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <span>{wmoEmoji(code)}</span>
        <span className="font-medium tabular-nums">{maxTemp}°</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <span>{wmoEmoji(code)}</span>
      <span className="font-medium tabular-nums">{maxTemp}°</span>
      <span className="tabular-nums">{minTemp}°</span>
    </div>
  )
}
