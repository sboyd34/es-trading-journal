export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/blind-backtest/sessions — list all sessions for user
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data, error } = await supabase
      .from('blind_backtest_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) throw error
    return NextResponse.json({ sessions: data ?? [] })
  } catch (err) {
    console.error('blind sessions GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/blind-backtest/sessions — create a new session
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { setup_filter, time_window_filter, total_trades_planned } = body

    const { data, error } = await supabase
      .from('blind_backtest_sessions')
      .insert({
        user_id: user.id,
        setup_filter: setup_filter ?? 'All',
        time_window_filter: time_window_filter ?? 'All',
        total_trades_planned: total_trades_planned ?? 10,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ session: data })
  } catch (err) {
    console.error('blind sessions POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
