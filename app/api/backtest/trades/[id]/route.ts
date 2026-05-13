export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface RouteParams { params: { id: string } }

const ALLOWED = [
  'entry_time', 'exit_time', 'direction', 'quantity', 'entry_price', 'exit_price',
  'instrument', 'gross_pnl', 'commission', 'net_pnl', 'stop_loss', 'target',
  'mae', 'mfe', 'mood', 'grade', 'setup_tag', 'notes', 'reflection', 'tags',
  'trade_bias', 'trade_setup', 'trade_trigger', 'trade_location', 'trade_risk',
]

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const update: Record<string, unknown> = {}
    for (const f of ALLOWED) { if (f in body) update[f] = body[f] }

    const { data, error } = await supabase
      .from('backtest_trades')
      .update(update)
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ trade: data })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { error } = await supabase
      .from('backtest_trades')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
