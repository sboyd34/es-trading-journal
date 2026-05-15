// Shared Polygon aggregates fetcher. Used by the blind-backtest chart
// route and the per-trade auto-chart route.

export interface PolygonCandle {
  t: number  // Unix timestamp seconds (UTC)
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface PolygonAggResult {
  t: number  // ms
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface FetchOpts {
  ticker: string
  fromMs: number
  toMs: number
  multiplier?: number     // default 1
  timespan?: 'minute' | 'hour' | 'day'  // default 'minute'
  apiKey: string
  adjusted?: boolean      // default true
  limit?: number          // default 5000
}

export async function fetchAggregates(opts: FetchOpts): Promise<PolygonCandle[] | null> {
  const {
    ticker,
    fromMs,
    toMs,
    multiplier = 1,
    timespan = 'minute',
    apiKey,
    adjusted = true,
    limit = 5000,
  } = opts

  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${fromMs}/${toMs}?apiKey=${apiKey}&adjusted=${adjusted}&sort=asc&limit=${limit}`

  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return null
  const data = await res.json()
  if (!data.results || data.results.length === 0) return null

  return (data.results as PolygonAggResult[]).map((r) => ({
    t: Math.floor(r.t / 1000),
    o: r.o,
    h: r.h,
    l: r.l,
    c: r.c,
    v: r.v,
  }))
}
