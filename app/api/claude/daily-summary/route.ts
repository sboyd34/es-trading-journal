export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { Trade } from '@/types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { date } = await request.json()

    if (!date || typeof date !== 'string') {
      return NextResponse.json({ error: 'date is required (YYYY-MM-DD)' }, { status: 400 })
    }

    // Fetch all trades for that date
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', date)
      .order('entry_time', { ascending: true })

    if (!trades || trades.length === 0) {
      return NextResponse.json({ error: 'No trades found for this date' }, { status: 404 })
    }

    const typedTrades = trades as Trade[]
    const totalNetPnL = typedTrades.reduce((s, t) => s + t.net_pnl, 0)
    const winners = typedTrades.filter((t) => t.net_pnl > 0)
    const losers = typedTrades.filter((t) => t.net_pnl <= 0)

    const tradesSummary = typedTrades.map((t, i) => {
      return `Trade ${i + 1}: ${t.direction.toUpperCase()} ${t.quantity} contract(s) | Entry: ${t.entry_price} | Exit: ${t.exit_price} | Net P&L: $${t.net_pnl.toFixed(2)} | Mood: ${t.mood || 'untagged'} | Grade: ${t.grade || 'ungraded'} | Notes: ${t.notes || 'none'}`
    }).join('\n')

    const systemPrompt = `You are an expert ES futures trading coach analyzing a trader's trading day. Your role is to provide honest, constructive, specific feedback that helps the trader improve.

Generate an end-of-day summary in the following JSON format. Be specific and reference actual trade data. Avoid generic feedback. Be direct but supportive.

Return ONLY valid JSON with these exact keys:
{
  "what_happened": "Factual summary of the trading day — market conditions, how many trades, overall outcome",
  "trades_review": "Trade-by-trade analysis highlighting what was executed well and what wasn't",
  "emotional_state": "Assessment of the trader's emotional state based on mood tags and trade patterns",
  "mistakes": "Specific mistakes made today — be direct and honest",
  "wins": "Specific things done well today — genuine positives, not platitudes",
  "lesson": "The single most important lesson from today's trading",
  "tomorrow_focus": "1-2 specific, actionable things to focus on tomorrow"
}`

    const userMessage = `Date: ${date}
Total P&L: $${totalNetPnL.toFixed(2)}
Trades: ${typedTrades.length} (${winners.length} winners, ${losers.length} losers)
Win rate: ${((winners.length / typedTrades.length) * 100).toFixed(1)}%

Trade details:
${tradesSummary}

Please generate my end-of-day summary.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    let summary
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      summary = JSON.parse(jsonMatch[0])
    } catch {
      console.error('Failed to parse Claude daily summary response:', responseText)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    // Save to daily_sessions
    const { data: existingSession } = await supabase
      .from('daily_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('date', date)
      .single()

    if (existingSession) {
      await supabase
        .from('daily_sessions')
        .update({ end_of_day_summary: summary })
        .eq('id', existingSession.id)
    } else {
      await supabase
        .from('daily_sessions')
        .insert({
          user_id: user.id,
          date,
          end_of_day_summary: summary,
        })
    }

    return NextResponse.json({ summary })
  } catch (err) {
    console.error('Daily summary Claude error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
