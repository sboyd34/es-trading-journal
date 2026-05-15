// Finnhub earnings calendar — scheduled earnings dates with BMO/AMC timing.
// Free tier: 60 calls/min, no credit card required.
// Docs: https://finnhub.io/docs/api/earnings-calendar

export const DEFAULT_EARNINGS_WATCHLIST = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA',
  'JPM', 'BAC', 'WMT', 'HD',
]

type FinnhubHour = 'bmo' | 'amc' | 'dmh' | ''

interface FinnhubEarning {
  date: string
  epsActual: number | null
  epsEstimate: number | null
  hour: FinnhubHour
  quarter: number
  revenueActual: number | null
  revenueEstimate: number | null
  symbol: string
  year: number
}

export interface EarningsEvent {
  symbol: string
  date: string
  /** bmo = before market open, amc = after market close, dmh = during market hours, '' = unknown */
  hour: FinnhubHour
  hourLabel: 'BMO' | 'AMC' | 'DMH' | 'TBD'
  epsEstimate: number | null
  revenueEstimate: number | null
  quarter: number
  year: number
}

const HOUR_LABEL: Record<FinnhubHour, EarningsEvent['hourLabel']> = {
  bmo: 'BMO',
  amc: 'AMC',
  dmh: 'DMH',
  '': 'TBD',
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function fetchUpcomingEarnings(params: {
  apiKey: string
  days?: number
  symbols?: string[]
}): Promise<EarningsEvent[]> {
  const { apiKey, days = 7, symbols = DEFAULT_EARNINGS_WATCHLIST } = params

  const from = ymd(new Date())
  const to = ymd(new Date(Date.now() + days * 24 * 60 * 60 * 1000))

  const url = new URL('https://finnhub.io/api/v1/calendar/earnings')
  url.searchParams.set('from', from)
  url.searchParams.set('to', to)
  url.searchParams.set('token', apiKey)

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { earningsCalendar?: FinnhubEarning[] }
    const watchlist = new Set(symbols.map((s) => s.toUpperCase()))

    return (data.earningsCalendar || [])
      .filter((e) => watchlist.has(e.symbol.toUpperCase()))
      .map((e) => ({
        symbol: e.symbol,
        date: e.date,
        hour: e.hour,
        hourLabel: HOUR_LABEL[e.hour] ?? 'TBD',
        epsEstimate: e.epsEstimate,
        revenueEstimate: e.revenueEstimate,
        quarter: e.quarter,
        year: e.year,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

/** Returns the millisecond timestamp of the earnings print window's start.
 *  BMO ≈ 06:00 ET, AMC ≈ 16:05 ET, DMH ≈ midday. Used for proximity matching to trades. */
export function earningsEventTimestamp(e: EarningsEvent): number {
  // Treat the date as ET. Append a wall-clock and let Date parse as UTC-offset-naive.
  const wall =
    e.hour === 'bmo' ? '10:00:00Z' :   // 06:00 ET (EDT)
    e.hour === 'amc' ? '20:05:00Z' :   // 16:05 ET (EDT)
    e.hour === 'dmh' ? '17:00:00Z' :   // 13:00 ET (EDT)
                       '13:30:00Z'     // unknown -> 09:30 ET (open)
  return new Date(`${e.date}T${wall}`).getTime()
}
