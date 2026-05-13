export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const date = request.nextUrl.searchParams.get('date')

    if (date) {
      const { data, error } = await supabase
        .from('backtest_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', date)
        .single()
      if (error && error.code !== 'PGRST116') return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ session: data ?? null })
    }

    const { data, error } = await supabase
      .from('backtest_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ sessions: data ?? [] })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { date, onh, onl, pdh, pdl, vwap, bias, notes } = body

    if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 })

    const { data, error } = await supabase
      .from('backtest_sessions')
      .upsert(
        { user_id: user.id, date, onh: onh || null, onl: onl || null, pdh: pdh || null, pdl: pdl || null, vwap: vwap || null, bias: bias || null, notes: notes || null },
        { onConflict: 'user_id,date' }
      )
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ session: data })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
