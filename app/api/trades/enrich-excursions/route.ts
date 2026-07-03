export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAggregates } from '@/lib/polygon-chart'
import {
  computeExcursionsViaProxy,
  classifyLoss,
  EXCURSION_INSTRUMENTS,
  SPY_PROXY_TICKER,
} from '@/lib/excursions'

// Bounded per-request work so we never trip the serverless timeout, and a
// small gap between Polygon calls to stay under rate limits. The status index
// makes this resumable: re-POST until `remaining` hits 0.
const DEFAULT_BATCH = 40
const POLYGON_GAP_MS = 220

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface EnrichUpdate {
  excursion_status: 'complete' | 'failed' | 'no_data'
  mae_ticks?: number | null
  mfe_ticks?: number | null
  excursion_source?: string | null
  loss_type?: string | null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = process.env.POLYGON_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'POLYGON_API_KEY not configured' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const limit = Math.min(Math.max(Number(body?.limit) || DEFAULT_BATCH, 1), 100)

    // Pull the next batch of unprocessed trades (uses trades_excursion_status_idx).
    const { data: pending, error: fetchErr } = await supabase
      .from('trades')
      .select('id, direction, entry_price, entry_time, exit_time, net_pnl, instrument')
      .eq('user_id', user.id)
      .eq('excursion_status', 'pending')
      .order('date', { ascending: true })
      .limit(limit)

    if (fetchErr) {
      console.error('[enrich] fetch pending error:', fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }

    if (!pending || pending.length === 0) {
      return NextResponse.json({ processed: 0, complete: 0, no_data: 0, failed: 0, remaining: 0 })
    }

    let complete = 0
    let noData = 0
    let failed = 0

    for (let i = 0; i < pending.length; i++) {
      const trade = pending[i]
      let update: EnrichUpdate

      // NQ/MNQ (or anything non-S&P) can't be measured against MES bars.
      if (!EXCURSION_INSTRUMENTS.has(trade.instrument)) {
        update = { excursion_status: 'no_data', mae_ticks: null, mfe_ticks: null, excursion_source: null, loss_type: null }
        noData++
      } else {
        try {
          const entryMs = new Date(trade.entry_time).getTime()
          const exitMs = new Date(trade.exit_time).getTime()
          // Floor `from` to the minute so the bar containing the entry fill is included.
          const fromMs = Math.floor(entryMs / 60000) * 60000
          const toMs = exitMs

          const candles = await fetchAggregates({
            ticker: SPY_PROXY_TICKER,
            fromMs,
            toMs,
            apiKey,
          })

          const result = candles && computeExcursionsViaProxy(trade.direction, trade.entry_price, candles)

          if (!result) {
            // Queried successfully but no usable bars — terminal, won't retry.
            update = { excursion_status: 'no_data', mae_ticks: null, mfe_ticks: null, excursion_source: null, loss_type: null }
            noData++
          } else {
            const lossType = classifyLoss(trade.net_pnl, result.mfe_ticks)
            update = {
              excursion_status: 'complete',
              mae_ticks: result.mae_ticks,
              mfe_ticks: result.mfe_ticks,
              excursion_source: result.excursion_source,
              loss_type: lossType,
            }
            complete++
          }

          if (i < pending.length - 1) await sleep(POLYGON_GAP_MS)
        } catch (err) {
          // Transient (network/rate limit) — stays 'pending'-adjacent as 'failed', retryable.
          console.error('[enrich] trade', trade.id, 'failed:', err)
          update = { excursion_status: 'failed' }
          failed++
        }
      }

      const { error: updErr } = await supabase
        .from('trades')
        .update(update)
        .eq('id', trade.id)
        .eq('user_id', user.id)

      if (updErr) {
        console.error('[enrich] update error for', trade.id, updErr)
      }
    }

    // How many still need processing after this batch.
    const { count: remaining } = await supabase
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('excursion_status', 'pending')

    return NextResponse.json({
      processed: pending.length,
      complete,
      no_data: noData,
      failed,
      remaining: remaining ?? 0,
    })
  } catch (err) {
    console.error('[enrich] route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
