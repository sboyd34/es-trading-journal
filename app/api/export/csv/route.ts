export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Papa from 'papaparse'
import { Trade } from '@/types'

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: trades, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_time', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const typedTrades = (trades || []) as Trade[]

    // Format trades for CSV export
    const csvData = typedTrades.map((trade) => ({
      date: trade.date,
      entry_time: trade.entry_time,
      exit_time: trade.exit_time,
      direction: trade.direction,
      quantity: trade.quantity,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      gross_pnl: trade.gross_pnl,
      commission: trade.commission,
      net_pnl: trade.net_pnl,
      mood: trade.mood || '',
      grade: trade.grade || '',
      setup_tag: trade.setup_tag || '',
      mae: trade.mae ?? '',
      mfe: trade.mfe ?? '',
      stop_loss: trade.stop_loss ?? '',
      target: trade.target ?? '',
      notes: trade.notes || '',
      reflection: trade.reflection || '',
      tags: (trade.tags || []).join('; '),
      trade_bias: trade.trade_bias || '',
      trade_setup: trade.trade_setup || '',
      trade_trigger: trade.trade_trigger || '',
      trade_location: trade.trade_location || '',
      trade_risk: trade.trade_risk || '',
      entry_chart_url: trade.entry_chart_url || '',
      exit_chart_url: trade.exit_chart_url || '',
      ai_narrative: trade.ai_narrative?.narrative || '',
      ai_what_went_right: (trade.ai_narrative?.what_went_right || []).join('; '),
      ai_what_went_wrong: (trade.ai_narrative?.what_went_wrong || []).join('; '),
      ai_key_lesson: trade.ai_narrative?.key_lesson || '',
      tradovate_order_id: trade.tradovate_order_id || '',
    }))

    const csv = Papa.unparse(csvData, {
      header: true,
      quotes: true,
    })

    const filename = `trading-journal-${new Date().toISOString().split('T')[0]}.csv`

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('Export CSV error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
