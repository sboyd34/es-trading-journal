export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface Candle {
  t: number   // Unix timestamp seconds (UTC)
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface ChartResponse {
  blindCandles: Candle[]
  fullCandles: Candle[]
  cutoffIndex: number    // last index of blindCandles in fullCandles
  cutoffTimeCT: string   // e.g. "10:15"
  historicalDate: string // revealed after submission
  ticker: string
}

// ── helpers ─────────────────────────────────────────────────────────────────

function formatCTHHMM(tsMs: number): string {
  return new Date(tsMs).toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function ctMinutes(tsMs: number): number {
  const s = formatCTHHMM(tsMs)
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay()
  return day >= 1 && day <= 5
}

function randomDateBetween(start: Date, end: Date): Date {
  const ms = start.getTime() + Math.random() * (end.getTime() - start.getTime())
  return new Date(ms)
}

// Stocks proxy for ES futures — Polygon Stocks Starter plan covers SPY intraday.
// SPY tracks the S&P 500 closely, so it's a reasonable proxy for ES practice.
const PROXY_TICKER = 'SPY'

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Market hours in CT minutes: 8:00 AM (480) – 3:15 PM (915)
const MARKET_OPEN_MIN = 480   // 8:00 CT
const MARKET_CLOSE_MIN = 915  // 3:15 CT

// Cutoff window for the "All" filter: 9:00 AM – 1:30 PM CT
const DEFAULT_CUTOFF_MIN_START = 540
const DEFAULT_CUTOFF_MIN_END   = 810

function windowRange(filter: string): { start: number; end: number } {
  switch (filter) {
    case 'Pre-market':   return { start: 480, end: 510 }
    case '8:30 open':    return { start: 510, end: 570 }
    case '9:30':         return { start: 570, end: 630 }
    case '10:00-11:00':  return { start: 600, end: 660 }
    case '11:00-13:00':  return { start: 660, end: 780 }
    case '13:00-14:30':  return { start: 780, end: 870 }
    case '14:30-15:00':  return { start: 870, end: 900 }
    case '15:00 close':  return { start: 900, end: 915 }
    default:             return { start: DEFAULT_CUTOFF_MIN_START, end: DEFAULT_CUTOFF_MIN_END }
  }
}

async function fetchPolygonCandles(ticker: string, date: string, apiKey: string): Promise<Candle[] | null> {
  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/5/minute/${date}/${date}?apiKey=${apiKey}&adjusted=true&sort=asc&limit=5000`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return null
  const data = await res.json()
  if (!data.results || data.results.length === 0) return null
  return (data.results as { t: number; o: number; h: number; l: number; c: number; v: number }[]).map((r) => ({
    t: Math.floor(r.t / 1000),
    o: r.o,
    h: r.h,
    l: r.l,
    c: r.c,
    v: r.v,
  }))
}

// ── route ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const apiKey = process.env.POLYGON_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Polygon API key not configured' }, { status: 500 })

    const sp = request.nextUrl.searchParams
    const timeFilter = sp.get('timeWindowFilter') ?? 'All'
    const replayDate = sp.get('date')        // YYYY-MM-DD — when set, fetch this specific day
    const replayCutoff = sp.get('cutoff')    // HH:MM CT — when set with date, cut off exactly here

    const cutoffWindow = windowRange(timeFilter)

    let candles: Candle[] | null = null
    let historicalDate = ''
    let ticker = ''

    ticker = PROXY_TICKER

    if (replayDate) {
      // Replay mode: deterministic lookup
      historicalDate = replayDate
      candles = await fetchPolygonCandles(ticker, historicalDate, apiKey)
    } else {
      // Random mode: pick a weekday between 2023-01-01 and 90 days ago
      const rangeStart = new Date('2023-01-01T00:00:00Z')
      const rangeEnd   = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      let attempts = 0
      while (!candles && attempts < 5) {
        attempts++
        let candidate = randomDateBetween(rangeStart, rangeEnd)
        let safety = 0
        while (!isWeekday(candidate) && safety < 10) {
          candidate = randomDateBetween(rangeStart, rangeEnd)
          safety++
        }
        if (!isWeekday(candidate)) continue

        historicalDate = yyyymmdd(candidate)
        candles = await fetchPolygonCandles(ticker, historicalDate, apiKey)
      }
    }

    if (!candles || candles.length === 0) {
      return NextResponse.json({ error: replayDate ? 'No chart data for that date.' : 'No chart data available after retries. Please try again.' }, { status: 503 })
    }

    // Filter to market hours only
    const marketCandles = candles.filter((c) => {
      const min = ctMinutes(c.t * 1000)
      return min >= MARKET_OPEN_MIN && min < MARKET_CLOSE_MIN
    })

    if (marketCandles.length < 10) {
      return NextResponse.json({ error: 'Insufficient market-hours data for this date.' }, { status: 503 })
    }

    let cutoffCandle: Candle
    if (replayDate && replayCutoff) {
      // Replay mode: find the candle whose CT time matches exactly
      const match = marketCandles.find((c) => formatCTHHMM(c.t * 1000) === replayCutoff)
      cutoffCandle = match ?? marketCandles[Math.floor(marketCandles.length / 2)]
    } else {
      // Random mode: pick a candle in the configured window
      const cutoffCandidates = marketCandles.filter((c) => {
        const min = ctMinutes(c.t * 1000)
        return min >= cutoffWindow.start && min <= cutoffWindow.end
      })
      if (cutoffCandidates.length > 0) {
        cutoffCandle = cutoffCandidates[Math.floor(Math.random() * cutoffCandidates.length)]
      } else {
        const midIdx = Math.floor(marketCandles.length * 0.4 + Math.random() * marketCandles.length * 0.3)
        cutoffCandle = marketCandles[midIdx]
      }
    }

    const cutoffIndex = marketCandles.findIndex((c) => c.t === cutoffCandle.t)
    // Ensure at least 6 candles before cutoff (30 min of context)
    const safeIndex = Math.max(6, cutoffIndex)
    const finalCutoffCandle = marketCandles[safeIndex]

    const blindCandles  = marketCandles.slice(0, safeIndex + 1)
    const fullCandles   = marketCandles

    const cutoffTimeCT = formatCTHHMM(finalCutoffCandle.t * 1000)

    const response: ChartResponse = {
      blindCandles,
      fullCandles,
      cutoffIndex: safeIndex,
      cutoffTimeCT,
      historicalDate,
      ticker,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('Blind backtest chart error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
