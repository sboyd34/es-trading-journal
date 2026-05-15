export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAggregates } from '@/lib/polygon-chart'

// SPY is the broad-market proxy. ES traders watching today's morning
// state should look at SPY's previous close, today's gap, and the
// opening range.

const DEFAULT_TICKER = 'SPY'

export interface MarketState {
  ticker: string
  asOf: number  // unix ms when this snapshot was generated
  prevDay: {
    date: string  // YYYY-MM-DD
    open: number
    high: number
    low: number
    close: number
  } | null
  today: {
    date: string  // YYYY-MM-DD
    sessionOpen: number | null   // first regular-hours bar's open
    lastTrade: number | null     // most recent print (may be pre-market)
    high: number | null          // running session high (regular hours)
    low: number | null           // running session low (regular hours)
    gapPct: number | null        // (lastTrade - prevClose) / prevClose * 100
    openingRange: { high: number; low: number } | null
  } | null
  sessionStatus: 'pre-open' | 'opening-range' | 'in-session' | 'after-hours' | 'no-data'
}

// CT minute helpers
function ctMinutes(tsMs: number): number {
  const s = new Date(tsMs).toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

const REGULAR_OPEN_CT  = 8 * 60 + 30  // 8:30 CT
const REGULAR_CLOSE_CT = 15 * 60      // 15:00 CT
const OPENING_RANGE_END_CT = REGULAR_OPEN_CT + 30  // 9:00 CT

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const apiKey = process.env.POLYGON_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Polygon API key not configured' }, { status: 500 })

    const ticker = req.nextUrl.searchParams.get('ticker') ?? DEFAULT_TICKER

    // 1) Previous trading day OHLC
    const prevUrl = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true&apiKey=${apiKey}`
    let prevDay: MarketState['prevDay'] = null
    try {
      const prevRes = await fetch(prevUrl, { cache: 'no-store' })
      if (prevRes.ok) {
        const data = await prevRes.json()
        const r = data?.results?.[0]
        if (r) {
          prevDay = {
            date: new Date(r.t).toISOString().slice(0, 10),
            open: r.o, high: r.h, low: r.l, close: r.c,
          }
        }
      }
    } catch {
      // best-effort
    }

    // 2) Today's intraday — minute bars from start of day
    const now = new Date()
    const todayDate = ymd(now)
    const dayStart = new Date(`${todayDate}T00:00:00Z`).getTime()
    const dayEnd   = dayStart + 24 * 60 * 60_000

    const candles = await fetchAggregates({
      ticker,
      fromMs: dayStart,
      toMs: dayEnd,
      multiplier: 1,
      timespan: 'minute',
      apiKey,
    })

    let today: MarketState['today'] = null
    let sessionStatus: MarketState['sessionStatus'] = 'no-data'

    if (candles && candles.length > 0) {
      let sessionOpen: number | null = null
      let high = -Infinity
      let low  = Infinity
      const openingRangeBars: { h: number; l: number }[] = []

      for (const c of candles) {
        const min = ctMinutes(c.t * 1000)
        if (min >= REGULAR_OPEN_CT && min < REGULAR_CLOSE_CT) {
          if (sessionOpen === null) sessionOpen = c.o
          if (c.h > high) high = c.h
          if (c.l < low) low = c.l
          if (min < OPENING_RANGE_END_CT) {
            openingRangeBars.push({ h: c.h, l: c.l })
          }
        }
      }

      const lastBar = candles[candles.length - 1]
      const lastTrade = lastBar.c
      const gapPct = prevDay
        ? ((lastTrade - prevDay.close) / prevDay.close) * 100
        : null
      const openingRange = openingRangeBars.length > 0 ? {
        high: Math.max(...openingRangeBars.map((b) => b.h)),
        low:  Math.min(...openingRangeBars.map((b) => b.l)),
      } : null

      today = {
        date: todayDate,
        sessionOpen,
        lastTrade,
        high: high === -Infinity ? null : high,
        low:  low  ===  Infinity ? null : low,
        gapPct,
        openingRange,
      }

      // Determine session status from current CT time
      const nowMin = ctMinutes(Date.now())
      if (nowMin < REGULAR_OPEN_CT)              sessionStatus = 'pre-open'
      else if (nowMin < OPENING_RANGE_END_CT)    sessionStatus = 'opening-range'
      else if (nowMin < REGULAR_CLOSE_CT)        sessionStatus = 'in-session'
      else                                       sessionStatus = 'after-hours'
    }

    const state: MarketState = {
      ticker,
      asOf: Date.now(),
      prevDay,
      today,
      sessionStatus,
    }

    return NextResponse.json(state)
  } catch (err) {
    console.error('Market state error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
