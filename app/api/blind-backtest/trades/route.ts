export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/blind-backtest/trades — save a completed blind backtest trade
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const {
      session_id,
      historical_date,
      instrument,
      contract_type,
      chart_cutoff_time,
      trade_bias,
      trade_setup,
      trade_trigger,
      trade_location,
      trade_risk,
      entry_price,
      stop_price,
      target_price,
      direction,
      confidence,
      outcome,
      gross_pnl,
      r_multiple,
      mfe,
      mae,
      ai_grade,
      ai_feedback,
      self_grade,
      mood,
      notes,
      reflection,
      chart_url,
      mistake_type,
      mistake_other,
      bars_held,
      entry_bar_index,
      playback_mode,
    } = body

    const { data, error } = await supabase
      .from('blind_backtest_trades')
      .insert({
        user_id: user.id,
        session_id,
        historical_date,
        instrument:        instrument   ?? 'ES',
        contract_type:     contract_type ?? 'ES',
        chart_cutoff_time,
        trade_bias,
        trade_setup,
        trade_trigger,
        trade_location,
        trade_risk,
        entry_price,
        stop_price,
        target_price,
        direction,
        confidence,
        outcome,
        gross_pnl,
        r_multiple,
        mfe,
        mae,
        ai_grade,
        ai_feedback,
        self_grade,
        mood,
        notes,
        reflection,
        chart_url,
        mistake_type,
        mistake_other,
        bars_held,
        entry_bar_index,
        playback_mode: playback_mode ?? 'B',
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ trade: data })
  } catch (err) {
    console.error('blind trades POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/blind-backtest/trades — aggregate stats; pass ?detail=1 for full trade list
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const detail = request.nextUrl.searchParams.get('detail') === '1'

    if (detail) {
      const { data, error } = await supabase
        .from('blind_backtest_trades')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return NextResponse.json({ trades: data ?? [] })
    }

    const { data, error } = await supabase
      .from('blind_backtest_trades')
      .select('outcome, r_multiple, ai_grade, self_grade')
      .eq('user_id', user.id)

    if (error) throw error

    const trades = data ?? []
    const total  = trades.length
    const wins   = trades.filter((t) => t.outcome === 'WIN').length
    const losses = trades.filter((t) => t.outcome === 'LOSS').length
    const scratches = trades.filter((t) => t.outcome === 'SCRATCH').length
    const rVals  = trades.map((t) => t.r_multiple).filter((r): r is number => r != null)
    const avgR   = rVals.length ? rVals.reduce((s, r) => s + r, 0) / rVals.length : null
    const bestR  = rVals.length ? Math.max(...rVals) : null
    const grades = { A: 0, B: 0, C: 0 }
    for (const t of trades) {
      if (t.ai_grade === 'A') grades.A++
      else if (t.ai_grade === 'B') grades.B++
      else if (t.ai_grade === 'C') grades.C++
    }

    return NextResponse.json({ total, wins, losses, scratches, avgR, bestR, grades, winRate: total ? (wins / total) * 100 : 0 })
  } catch (err) {
    console.error('blind trades GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
