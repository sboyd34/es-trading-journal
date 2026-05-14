export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
      trade_bias, trade_setup, trade_trigger, trade_location, trade_risk,
      entry_price, stop_price, target_price, direction, confidence, outcome,
    } = await request.json()

    const riskPoints = Math.abs(entry_price - stop_price)
    const rewardPoints = Math.abs(target_price - entry_price)
    const rr = riskPoints > 0 ? (rewardPoints / riskPoints).toFixed(2) : 'N/A'

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: `You are a trading coach evaluating a backtest trade against the trader's ES/MES Process-First Execution Framework. The trader's five official setups are: ORB (Opening Range Breakout), TTM Squeeze, AVWAP (Anchored VWAP), FVG (Fair Value Gap), and Divergence. Grade the trader's pre-trade reasoning on a scale of A, B, or C:
A = Clear setup identification, defined trigger, logical location, specific risk with stop placement, realistic target
B = Most elements present but one is vague or missing
C = Vague reasoning, undefined risk, or setup does not match trigger
Respond with EXACTLY this format (no other text):
GRADE: [A/B/C]
WELL: [one sentence on what was done well]
IMPROVE: [one sentence on what could be improved]`,
      messages: [{
        role: 'user',
        content: `Evaluate this backtest trade:
Bias: ${trade_bias}
Setup: ${trade_setup}
Trigger: ${trade_trigger}
Location: ${trade_location}
Risk plan: ${trade_risk}
Entry: ${entry_price} | Stop: ${stop_price} | Target: ${target_price}
Direction: ${direction} | R/R: ${rr}:1 | Confidence: ${confidence}/5
Outcome: ${outcome}`,
      }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    const gradeMatch = text.match(/GRADE:\s*([ABC])/i)
    const wellMatch  = text.match(/WELL:\s*(.+)/i)
    const improveMatch = text.match(/IMPROVE:\s*(.+)/i)

    return NextResponse.json({
      grade:   gradeMatch?.[1]?.toUpperCase() ?? 'B',
      well:    wellMatch?.[1]?.trim() ?? '',
      improve: improveMatch?.[1]?.trim() ?? '',
    })
  } catch (err) {
    console.error('blind grade error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
