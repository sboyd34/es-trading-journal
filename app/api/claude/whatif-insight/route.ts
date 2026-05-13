export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

function fmtPF(pf: number): string {
  if (pf === Infinity) return '∞'
  return pf.toFixed(2)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { actual, simulated, scenarios, dollarDifference, percentChange } = await request.json()

    const scenarioList = (scenarios as string[]).join(', ')
    const diffSign = dollarDifference >= 0 ? '+' : ''
    const pctSign = percentChange >= 0 ? '+' : ''

    const prompt = `You are an expert ES futures trading coach reviewing a What-If simulation for a trader.

ACTUAL results (${actual.total} trades):
- Win rate: ${actual.winRate?.toFixed(1)}%
- Net P&L: $${actual.netPnL?.toFixed(2)}
- Profit factor: ${fmtPF(actual.profitFactor)}
- Avg R-multiple: ${actual.avgRMultiple != null ? actual.avgRMultiple.toFixed(2) + 'R' : 'N/A (no stops set)'}

SIMULATED results if the trader had applied: ${scenarioList}
- Trades: ${simulated.total} (vs ${actual.total} actual)
- Win rate: ${simulated.winRate?.toFixed(1)}%
- Net P&L: $${simulated.netPnL?.toFixed(2)}
- Profit factor: ${fmtPF(simulated.profitFactor)}
- Avg R-multiple: ${simulated.avgRMultiple != null ? simulated.avgRMultiple.toFixed(2) + 'R' : 'N/A'}

Net impact: ${diffSign}$${Math.abs(dollarDifference).toFixed(2)} (${pctSign}${percentChange.toFixed(1)}%)

Write 2-3 sentences. First sentence: what this data reveals about the trader's specific behavioral pattern or discipline gap. Second sentence: what is the most valuable finding from the simulation. Third sentence: one concrete, specific action the trader should take in their very next session. Be direct — no generic advice, no hedging.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    })

    const insight = message.content[0].type === 'text' ? message.content[0].text.trim() : ''
    return NextResponse.json({ insight })
  } catch (err) {
    console.error('What-if insight error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
