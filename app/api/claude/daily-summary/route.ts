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
    const totalGrossPnL = typedTrades.reduce((s, t) => s + t.gross_pnl, 0)
    const totalCommission = typedTrades.reduce((s, t) => s + t.commission, 0)
    const winners = typedTrades.filter((t) => t.net_pnl > 0)
    const losers = typedTrades.filter((t) => t.net_pnl <= 0)

    const tradesSummary = typedTrades.map((t, i) => {
      const entryTimeCT = new Date(t.entry_time).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
      return `Trade ${i + 1}: ${t.direction.toUpperCase()} ${t.quantity}x ${t.instrument || 'ES'} | Entry: ${t.entry_price} at ${entryTimeCT} CT | Exit: ${t.exit_price} | Gross P&L: $${t.gross_pnl.toFixed(2)} | Commission: $${t.commission.toFixed(2)} | Net P&L: $${t.net_pnl.toFixed(2)} | Setup: ${t.setup_tag || t.trade_setup || 'untagged'} | Bias: ${t.trade_bias || 'not recorded'} | Location: ${t.trade_location || 'not recorded'} | Mood: ${t.mood || 'untagged'} | Grade: ${t.grade || 'ungraded'} | Notes: ${t.notes || 'none'}`
    }).join('\n')

    const systemPrompt = `You are an expert ES futures trading coach. This trader uses a strict rules-based system — evaluate every trade against it. Be direct and specific. Never give generic feedback.

TRADING SYSTEM RULES:
Core Model: 1H Bias → 15m Setup → 5m Trigger
- Bull bias → longs only; Bear bias → shorts only; Neutral → retests only or no trade

Approved Time Windows (CT): 08:45–09:30 ORB primary; 09:30–10:30 continuation; 10:30–11:00 A+ only; 12:30–14:00 secondary (3 gates required); ALL other times = no trade.

Setup Priority: (1) ORB Break (2) TTM Squeeze (3) AVWAP Bounce (4) FVG Bounce (5) Divergence/Trendline Break (alert only).

Entry Rule: Break → Retest → Confirm → Enter. NEVER anticipate, blind-touch, chase, or enter on bubble/fire alone.

Approved Locations: ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight high/low, prior swing extremes, fresh supply/demand.
BANNED Locations: POC, mid-value, overlapping candles, obvious chop.

Hard Operating Rule: Bias. Setup. Trigger. Location. Risk. — all five must be stated before entering. If any is missing = rule violation = C grade minimum.

Grade Rubric:
A: All criteria met — bias clear, correct setup, approved location, Break→Retest→Confirm→Enter, approved time window, emotionally flat
B: One minor deviation (slightly early, Tier 2 location without extra confirm, small size)
C: ANY of: POC/chop/mid-value entry, wrong time window, wrong direction vs bias, chased candle, entered on fire alone, FOMO/revenge state, blind-touch

For each trade, explicitly state:
1. Was the time window approved?
2. Does the entry location match approved locations (call out if it's a banned location)?
3. Was the entry sequence (Break→Retest→Confirm→Enter) followed?
4. Does the direction match the 1H bias?
5. Which of the 6 setups was this? Is the grade appropriate per the rubric?

Return ONLY valid JSON with these exact keys:
{
  "what_happened": "Factual summary — time windows used, P&L outcome, day structure",
  "trades_review": "Trade-by-trade system evaluation — call out each rule followed or violated with specific references",
  "emotional_state": "Assessment based on mood tags, trade sequence, and any revenge/FOMO patterns",
  "mistakes": "Specific rule violations — name the exact rule broken (time window, location, entry sequence, bias alignment)",
  "wins": "Specific rules followed correctly — genuine positives with exact rule references",
  "lesson": "The single most important system rule to focus on",
  "tomorrow_focus": "1-2 specific rule-based behaviors to enforce tomorrow"
}`

    const userMessage = `Date: ${date}
Gross P&L: $${totalGrossPnL.toFixed(2)} | Commission: $${totalCommission.toFixed(2)} | Net P&L: $${totalNetPnL.toFixed(2)}
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
      const cleaned = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
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
