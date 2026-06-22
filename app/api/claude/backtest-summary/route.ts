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

    const { comparison } = await request.json()

    if (!comparison || !Array.isArray(comparison)) {
      return NextResponse.json({ error: 'comparison array required' }, { status: 400 })
    }

    const comparisonText = comparison.map((row: {
      setup: string
      backtest: { count: number; winRate: number; avgPnL: number }
      live: { count: number; winRate: number; avgPnL: number }
    }) => {
      const bt = row.backtest
      const live = row.live
      return `${row.setup}:
  Backtest: ${bt.count} trades, ${bt.winRate.toFixed(1)}% win rate, avg $${bt.avgPnL.toFixed(0)} P&L
  Live: ${live.count} trades, ${live.winRate.toFixed(1)}% win rate, avg $${live.avgPnL.toFixed(0)} P&L
  Gap: ${(live.winRate - bt.winRate).toFixed(1)}% win rate difference, avg $${(live.avgPnL - bt.avgPnL).toFixed(0)} P&L difference`
    }).join('\n\n')

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are an expert ES futures trading coach analyzing the gap between a trader's backtesting results and live trading performance.

The trader uses this system: 1H Bias → 15m Setup → 5m Trigger. Entry rule: Break→Retest→Confirm→Enter. Six setups in priority order: ORB Break, TTM Squeeze, AVWAP Bounce, FVG Bounce, VAH/VAL Bounce, Divergence/Trendline Break.

Common reasons for backtest→live performance gaps:
- Execution hesitation (seeing the setup but not pulling the trigger)
- Emotional interference (FOMO, revenge, hesitation)
- Slippage or late entries in live markets
- Backtest doesn't account for spread/commission properly
- Cherry-picking setups in backtest vs. real-time pressure
- Skipping the Break→Retest→Confirm→Enter sequence under pressure

Be direct, specific, and actionable. Reference the exact setups with the biggest gaps. Identify the most likely behavioral cause.`,
      messages: [{
        role: 'user',
        content: `Here is my backtest vs live trading comparison by setup:\n\n${comparisonText}\n\nAnalyze the performance gaps and identify the behavioral causes. For each setup with a significant gap, explain what is most likely happening in live trading that doesn't happen in backtesting. Give me 2-3 specific, actionable steps to close the gap.`,
      }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    return NextResponse.json({ summary: text })
  } catch (err) {
    console.error('Backtest summary error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
