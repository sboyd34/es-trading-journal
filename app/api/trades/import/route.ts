export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ParsedTrade } from '@/lib/tradovate-parser'

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

    const tradeRows = trades.map((trade) => ({
      user_id: user.id,
      date: trade.date,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      direction: trade.direction,
      quantity: trade.quantity,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      commission: trade.commission,
      tradovate_order_id: trade.tradovate_order_id || null,
      tags: [],
    }))

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
