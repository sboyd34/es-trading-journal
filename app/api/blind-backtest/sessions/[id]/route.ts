export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/blind-backtest/sessions/[id] — session detail with trades
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const [sessionRes, tradesRes] = await Promise.all([
      supabase.from('blind_backtest_sessions').select('*').eq('id', params.id).eq('user_id', user.id).single(),
      supabase.from('blind_backtest_trades').select('*').eq('session_id', params.id).eq('user_id', user.id).order('created_at', { ascending: true }),
    ])

    if (sessionRes.error || !sessionRes.data) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ session: sessionRes.data, trades: tradesRes.data ?? [] })
  } catch (err) {
    console.error('blind session GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/blind-backtest/sessions/[id] — update session (complete it, store summary stats)
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { wins, losses, scratches, avg_r_multiple, ai_session_note, completed_at } = body

    const { data, error } = await supabase
      .from('blind_backtest_sessions')
      .update({
        wins:            wins            ?? 0,
        losses:          losses          ?? 0,
        scratches:       scratches       ?? 0,
        avg_r_multiple:  avg_r_multiple  ?? null,
        ai_session_note: ai_session_note ?? null,
        completed_at:    completed_at    ?? new Date().toISOString(),
      })
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ session: data })
  } catch (err) {
    console.error('blind session PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
