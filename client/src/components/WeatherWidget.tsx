import { useState, useEffect, useCallback } from 'react'
import {
  Sun, Cloud, CloudRain, CloudSnow, CloudLightning, Wind,
  Droplets, Thermometer, MapPin, ArrowRight,
} from 'lucide-react'

interface WeatherData {
  name: string
  sys: { country: string }
  main: { temp: number; feels_like: number; humidity: number; temp_min: number; temp_max: number }
  weather: [{ description: string; main: string }]
  wind: { speed: number }
}

const conditionIcon = (main: string) => {
  const props = { size: 16, strokeWidth: 1.5 }
  switch (main) {
    case 'Clear':        return <Sun {...props} />
    case 'Clouds':       return <Cloud {...props} />
    case 'Rain':
    case 'Drizzle':      return <CloudRain {...props} />
    case 'Snow':         return <CloudSnow {...props} />
    case 'Thunderstorm': return <CloudLightning {...props} />
    default:             return <Wind {...props} />
  }
}

export default function WeatherWidget() {
  const [_city, setCity]          = useState(() => localStorage.getItem('fitmind_city') ?? '')
  const [input, setInput]         = useState('')
  const [data, setData]           = useState<WeatherData | null>(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchWeather = useCallback(async (c: string) => {
    if (!c.trim()) return
    setLoading(true)
    setError('')
    try {
      const ctrl = new AbortController()
      const timerId = setTimeout(() => ctrl.abort(), 10000)
      const res = await fetch(`/weather?city=${encodeURIComponent(c.trim())}`, { signal: ctrl.signal }).finally(() => clearTimeout(timerId))
      if (!res.ok) throw new Error('City not found')
      const json = await res.json() as any
      if (
        !json || typeof json !== 'object' ||
        !Array.isArray(json.weather) || json.weather.length === 0 ||
        typeof json.main?.temp !== 'number' ||
        typeof json.wind?.speed !== 'number'
      ) throw new Error('Unexpected weather response')
      setData(json as WeatherData)
      setLastUpdated(new Date())
      setCity(c.trim())
      localStorage.setItem('fitmind_city', c.trim())
    } catch {
      setError('City not found')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem('fitmind_city')
    if (saved) { setInput(saved); fetchWeather(saved) }
  }, [fetchWeather])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim()) fetchWeather(input)
  }

  return (
    <div className="weather-widget">
      <div className="ww-header">
        <span className="ww-title">
          <MapPin size={11} strokeWidth={2} /> Weather
        </span>
        {lastUpdated && (
          <span className="ww-updated">
            {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <form className="ww-search" onSubmit={handleSearch}>
        <input
          className="ww-input"
          placeholder="City name..."
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <button className="ww-go" type="submit" disabled={loading}>
          {loading ? '···' : <ArrowRight size={12} strokeWidth={2.5} />}
        </button>
      </form>

      {error && <div className="ww-error">{error}</div>}

      {data && (
        <div className="ww-card">
          <div className="ww-top">
            <div>
              <div className="ww-city">{data.name}, {data.sys.country}</div>
              <div className="ww-desc">{data.weather[0].description}</div>
            </div>
            <div className="ww-emoji">{conditionIcon(data.weather[0].main)}</div>
          </div>

          <div className="ww-temp">{Math.round(data.main.temp)}°C</div>

          <div className="ww-meta">
            <div className="ww-meta-row">
              <span><Thermometer size={10} strokeWidth={1.5} /> Feels like</span>
              <span>{Math.round(data.main.feels_like)}°C</span>
            </div>
            <div className="ww-meta-row">
              <span><Droplets size={10} strokeWidth={1.5} /> Humidity</span>
              <span>{data.main.humidity}%</span>
            </div>
            <div className="ww-meta-row">
              <span><Wind size={10} strokeWidth={1.5} /> Wind</span>
              <span>{Math.round(data.wind.speed * 3.6)} km/h</span>
            </div>
            <div className="ww-meta-row">
              <span><Sun size={10} strokeWidth={1.5} /> Range</span>
              <span>{Math.round(data.main.temp_min)}° – {Math.round(data.main.temp_max)}°</span>
            </div>
          </div>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="ww-empty">Enter a city to see conditions</div>
      )}
    </div>
  )
}
