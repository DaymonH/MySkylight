"use client"

import { useState, useEffect } from "react"
import { useQueries } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"

export interface WeatherDay {
  date: string
  code: number
  maxTemp: number
  minTemp: number
  precipChance: number // 0–100, peak hourly probability for the day
  windMax: number // mph, peak hourly windspeed for the day
  sunrise: string | null // ISO local time, e.g. "2026-06-14T05:32"
  sunset: string | null
}

interface OpenMeteoResponse {
  daily: {
    time: string[]
    weathercode: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    sunrise?: string[]
    sunset?: string[]
  }
  hourly?: {
    time: string[]
    precipitation_probability?: (number | null)[]
    windspeed_10m?: (number | null)[]
  }
}

function maxOf(arr: (number | null)[] | undefined): number {
  if (!arr || arr.length === 0) return 0
  let m = 0
  for (const v of arr) if (v != null && v > m) m = v
  return m
}

export function useGeolocation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  )

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {} // silently skip if denied
    )
  }, [])

  return coords
}

export function useWeatherDays(
  familyId: string,
  coords: { lat: number; lng: number } | null,
  dates: string[]
): Record<string, WeatherDay> {
  const api = useApi()

  const results = useQueries({
    queries: dates.map((date) => ({
      queryKey: ["weather", familyId, coords?.lat, coords?.lng, date],
      queryFn: async (): Promise<WeatherDay> => {
        const data = await api.get<OpenMeteoResponse>(
          `/families/${familyId}/weather?lat=${coords!.lat}&lng=${coords!.lng}&date=${date}`
        )
        return {
          date,
          code: data.daily.weathercode[0] ?? 0,
          maxTemp: Math.round(data.daily.temperature_2m_max[0] ?? 0),
          minTemp: Math.round(data.daily.temperature_2m_min[0] ?? 0),
          precipChance: Math.round(
            maxOf(data.hourly?.precipitation_probability)
          ),
          windMax: Math.round(maxOf(data.hourly?.windspeed_10m)),
          sunrise: data.daily.sunrise?.[0] ?? null,
          sunset: data.daily.sunset?.[0] ?? null,
        }
      },
      enabled: !!familyId && !!coords,
      staleTime: 60 * 60 * 1000,
    })),
  })

  const map: Record<string, WeatherDay> = {}
  for (const r of results) {
    if (r.data) map[r.data.date] = r.data
  }
  return map
}
