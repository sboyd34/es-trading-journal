export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

interface SessionTrade {
  trade_setup: string | null
  trade_trigger: string | null
  trade_risk: string | null
  outcome: string | null
  r_multiple: number | null
  ai_grade: string | null
  self_grade: string | null
  confidence: number | null
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { trades }: { trades: SessionTrade[] } = await request.json()
    if (!trades || trades.length === 0) {
      return NextResponse.json({ note: 'No trades to analyze.' })
    }

    const tradesText = trades.map((t, i) => {
      return `Trade ${i + 1}: Setup=${t.trade_setup ?? 'none'}, Outcome=${t.outcome ?? '?'}, R=${t.r_multiple?.toFixed(2) ?? '?'}, AI Grade=${t.ai_grade ?? '?'}, Self Grade=${t.self_grade ?? '?'}, Confidence=${t.confidence ?? '?'}/5`
    }).join('\n')

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 250,
      system: `You are an ES futures trading coach reviewing a completed blind backtest session. The trader practices 5 setups: ORB, TTM Squeeze, AVWAP, FVG, Divergence. Identify ONE specific, actionable pattern you noticed across their reasoning quality this session — what should they focus on before their next session? Be direct and specific. 2-3 sentences maximum.`,
      messages: [{
        role: 'user',
        content: `Session summary (${trades.length} trades):\n${tradesText}\n\nWhat one pattern do you notice in my reasoning quality, and what should I focus on next session?`,
      }],
    })

    const note = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return NextResponse.json({ note })
  } catch (err) {
    console.error('blind session note error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
