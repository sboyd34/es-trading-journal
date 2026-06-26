export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import { generatePreMarketBrief } from '@/lib/pre-market-brief'
import { computeEdgeStats } from '@/lib/edge-stats'
import { computePriorSession } from '@/lib/prior-session'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { context, newsHeadlines: clientHeadlines } = await request.json()

    if (!context || typeof context !== 'string') {
      return NextResponse.json({ error: 'context is required' }, { status: 400 })
    }

    const { data: edgeTrades } = await supabase
      .from('trades')
      .select('trade_bias, trade_setup, setup_tag, net_pnl, entry_time')
      .eq('user_id', user.id)
    const edgeStats = computeEdgeStats(edgeTrades ?? [])
    const priorSession = computePriorSession(edgeTrades ?? [])

    const brief = await generatePreMarketBrief(context, clientHeadlines, edgeStats, priorSession)
    if (!brief) {
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    const today = format(new Date(), 'yyyy-MM-dd')

    // Save to daily_sessions
    const { data: existingSession } = await supabase
      .from('daily_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('date', today)
      .single()

    if (existingSession) {
      await supabase
        .from('daily_sessions')
        .update({ pre_market_brief: brief })
        .eq('id', existingSession.id)
    } else {
      await supabase
        .from('daily_sessions')
        .insert({
          user_id: user.id,
          date: today,
          pre_market_brief: brief,
        })
    }

    return NextResponse.json({ brief })
  } catch (err) {
    console.error('Pre-market Claude error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
