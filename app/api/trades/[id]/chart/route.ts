export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAggregates, type PolygonCandle } from '@/lib/polygon-chart'
import { getProxy } from '@/lib/instrument-proxy'

// Padding around the trade window so the user sees context.
const PAD_BEFORE_MS = 30 * 60 * 1000  // 30 min before entry
const PAD_AFTER_MS  = 30 * 60 * 1000  // 30 min after exit

export interface TradeChartResponse {
  ticker: string
  proxyNote: string
  interval: { multiplier: number; timespan: 'minute' | 'hour' | 'day' }
  candles: PolygonCandle[]
  entryTimestamp: number   // unix seconds
  exitTimestamp: number    // unix seconds
  entryPrice: number       // proxy price at entry candle (close)
  exitPrice: number        // proxy price at exit candle (close)
  futuresEntryPrice: number  // the price recorded on the trade row (futures)
  futuresExitPrice: number
  direction: 'long' | 'short'
  stopProxyPrice: number | null  // null when stop_loss on trade is unset
  targetProxyPrice: number | null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const apiKey = process.env.POLYGON_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'Polygon API key not configured' }, { status: 500 })

    const { data: trade, error: tradeErr } = await supabase
      .from('trades')
      .select('id, user_id, instrument, direction, entry_time, exit_time, entry_price, exit_price, stop_loss, target')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (tradeErr || !trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })

    const entryMs = new Date(trade.entry_time).getTime()
    const exitMs  = new Date(trade.exit_time).getTime()
    if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs)) {
      return NextResponse.json({ error: 'Trade has invalid timestamps' }, { status: 400 })
    }

    const proxy = getProxy(trade.instrument ?? 'ES')

    const fromMs = entryMs - PAD_BEFORE_MS
    const toMs   = exitMs + PAD_AFTER_MS

    // Choose a multiplier that keeps candle count manageable.
    // < 2h trade → 1-min, 2-6h → 5-min, > 6h → 15-min.
    const span = exitMs - entryMs
    const multiplier = span < 2 * 60 * 60_000 ? 1 : span < 6 * 60 * 60_000 ? 5 : 15

    const candles = await fetchAggregates({
      ticker: proxy.ticker,
      fromMs,
      toMs,
      multiplier,
      timespan: 'minute',
      apiKey,
    })

    if (!candles || candles.length === 0) {
      return NextResponse.json({
        error: `No proxy data available for ${proxy.ticker} in this trade's time window. Likely an extended-hours trade outside the proxy's session.`,
      }, { status: 503 })
    }

    // Map entry/exit times → the nearest available candle (by absolute time distance).
    const entrySec = Math.floor(entryMs / 1000)
    const exitSec  = Math.floor(exitMs / 1000)
    const nearest = (target: number) => candles.reduce((best, c) =>
      Math.abs(c.t - target) < Math.abs(best.t - target) ? c : best
    , candles[0])

    const entryCandle = nearest(entrySec)
    const exitCandle  = nearest(exitSec)

    // Translate the trade's stop/target from futures price to proxy price using
    // the entry-bar ratio. Imperfect, but gives a useful visual reference.
    const futuresEntry = Number(trade.entry_price)
    const futuresExit  = Number(trade.exit_price)
    const proxyEntry   = entryCandle.c
    const ratio        = futuresEntry !== 0 ? proxyEntry / futuresEntry : 0

    const stopProxy   = trade.stop_loss != null && ratio > 0 ? Number(trade.stop_loss) * ratio : null
    const targetProxy = trade.target    != null && ratio > 0 ? Number(trade.target)    * ratio : null

    const response: TradeChartResponse = {
      ticker: proxy.ticker,
      proxyNote: proxy.note,
      interval: { multiplier, timespan: 'minute' },
      candles,
      entryTimestamp: entryCandle.t,
      exitTimestamp: exitCandle.t,
      entryPrice: entryCandle.c,
      exitPrice: exitCandle.c,
      futuresEntryPrice: futuresEntry,
      futuresExitPrice: futuresExit,
      direction: (trade.direction === 'short' ? 'short' : 'long'),
      stopProxyPrice: stopProxy,
      targetProxyPrice: targetProxy,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('Trade chart error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
