"use client"

import { useState, useEffect } from "react"
import { useQueries } from "@tanstack/react-query"
import { useApi } from "@/hooks/use-api"

export interface WeatherDay {
  date: string
  code: number
  maxTemp: number
  minTemp: number
}

interface OpenMeteoResponse {
  daily: {
    time: string[]
    weathercode: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
  }
}

export function useGeolocation() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, // silently skip if denied
    )
  }, [])

  return coords
}

export function useWeatherDays(
  familyId: string,
  coords: { lat: number; lng: number } | null,
  dates: string[],
): Record<string, WeatherDay> {
  const api = useApi()

  const results = useQueries({
    queries: dates.map((date) => ({
      queryKey: ["weather", familyId, coords?.lat, coords?.lng, date],
      queryFn: async (): Promise<WeatherDay> => {
        const data = await api.get<OpenMeteoResponse>(
          `/families/${familyId}/weather?lat=${coords!.lat}&lng=${coords!.lng}&date=${date}`,
        )
        return {
          date,
          code: data.daily.weathercode[0] ?? 0,
          maxTemp: Math.round(data.daily.temperature_2m_max[0] ?? 0),
          minTemp: Math.round(data.daily.temperature_2m_min[0] ?? 0),
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
