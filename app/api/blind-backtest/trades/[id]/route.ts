export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteParams { params: { id: string } }

// PATCH /api/blind-backtest/trades/[id] — update select fields on a blind trade
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = params
    const body = await request.json()

    const allowedFields = ['chart_url', 'notes', 'reflection', 'mood', 'self_grade']
    const updateData: Record<string, unknown> = {}
    for (const f of allowedFields) if (f in body) updateData[f] = body[f]

    const { data, error } = await supabase
      .from('blind_backtest_trades')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('blind trade PATCH error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })

    return NextResponse.json({ trade: data })
  } catch (err) {
    console.error('blind trade PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
