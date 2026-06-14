import { DropletsIcon, SunriseIcon, SunsetIcon, WindIcon } from "lucide-react"

interface WeatherIconProps {
  code: number
  maxTemp: number
  minTemp: number
  precipChance?: number
  windMax?: number
  sunrise?: string | null
  sunset?: string | null
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

function fmtTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  // Open-Meteo returns naive local time like "2026-06-14T05:32"; parse without TZ shift.
  const m = /T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  const h = Number(m[1])
  const mm = m[2]
  const ampm = h < 12 ? "AM" : "PM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${mm} ${ampm}`
}

export function WeatherIcon({
  code,
  maxTemp,
  minTemp,
  precipChance,
  windMax,
  sunrise,
  sunset,
  compact = false,
}: WeatherIconProps) {
  if (compact) {
    return (
      <div className="flex flex-col items-center gap-0 text-[11px] leading-tight text-muted-foreground">
        <div className="flex items-center gap-0.5">
          <span>{wmoEmoji(code)}</span>
          <span className="font-medium tabular-nums">
            {maxTemp}°<span className="opacity-60">/{minTemp}°</span>
          </span>
        </div>
        {precipChance != null && precipChance >= 30 && (
          <div className="flex items-center gap-0.5 tabular-nums">
            <DropletsIcon className="size-2.5" />
            {precipChance}%
          </div>
        )}
      </div>
    )
  }

  const sunriseStr = fmtTime(sunrise)
  const sunsetStr = fmtTime(sunset)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <span className="text-base leading-none">{wmoEmoji(code)}</span>
        <span className="font-medium tabular-nums">{maxTemp}°</span>
        <span className="tabular-nums opacity-70">/ {minTemp}°</span>
      </div>
      {precipChance != null && precipChance > 0 && (
        <div className="flex items-center gap-1 tabular-nums">
          <DropletsIcon className="size-3.5" />
          {precipChance}%
        </div>
      )}
      {windMax != null && windMax > 0 && (
        <div className="flex items-center gap-1 tabular-nums">
          <WindIcon className="size-3.5" />
          {windMax} mph
        </div>
      )}
      {sunriseStr && (
        <div className="flex items-center gap-1 tabular-nums">
          <SunriseIcon className="size-3.5" />
          {sunriseStr}
        </div>
      )}
      {sunsetStr && (
        <div className="flex items-center gap-1 tabular-nums">
          <SunsetIcon className="size-3.5" />
          {sunsetStr}
        </div>
      )}
    </div>
  )
}
