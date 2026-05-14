export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ParsedTrade } from '@/lib/tradovate-parser'
import { fetchPolygonNews, findNewsRelatedEntryTimes } from '@/lib/polygon-news'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { trades }: { trades: ParsedTrade[] } = body

    if (!Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ error: 'No trades provided' }, { status: 400 })
    }

    // Fetch news to detect news-driven trades before inserting
    let newsRelatedEntryTimes = new Set<string>()
    const apiKey = process.env.POLYGON_API_KEY
    if (apiKey && trades.length > 0) {
      try {
        const entryTimes = trades.map((t) => new Date(t.entry_time).getTime())
        const minTime = new Date(Math.min(...entryTimes) - 15 * 60 * 1000)
        const maxTime = new Date(Math.max(...entryTimes) + 15 * 60 * 1000)
        const articles = await fetchPolygonNews({
          apiKey,
          publishedGte: minTime.toISOString(),
          publishedLte: maxTime.toISOString(),
          limit: 50,
        })
        newsRelatedEntryTimes = findNewsRelatedEntryTimes(trades, articles)
      } catch {
        // News check is best-effort; proceed without it
      }
    }

    const ALL_IN_RATES: Record<string, number> = {
      ES: 3.10,
      MES: 0.31,
    }

    // gross_pnl and net_pnl are GENERATED ALWAYS AS columns — never insert them.
    const tradeRows = trades.map((trade) => {
      const instrument = trade.instrument || 'ES'
      const quantity = trade.quantity
      const commission = Math.round((ALL_IN_RATES[instrument] ?? 3.472) * quantity * 1000) / 1000

      console.log('[import] instrument:', instrument, '| qty:', quantity, '| commission:', commission)

      return {
        user_id: user.id,
        date: trade.date,
        entry_time: trade.entry_time,
        exit_time: trade.exit_time,
        direction: trade.direction,
        quantity,
        entry_price: trade.entry_price,
        exit_price: trade.exit_price,
        commission,
        instrument,
        tradovate_order_id: trade.tradovate_order_id || null,
        tags: newsRelatedEntryTimes.has(trade.entry_time) ? ['news driven'] : [],
      }
    })

    const { data, error } = await supabase
      .from('trades')
      .insert(tradeRows)
      .select()

    if (error) {
      console.error('Insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ inserted: data?.length || 0 })
  } catch (err) {
    console.error('Import route error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
