export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { Trade, DailySession } from '@/types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// YYYY-MM-DD → epoch day count (timezone-agnostic, used for date math).
function dateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + n)
  return next
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function weekdayLabel(date: string): string {
  const d = dateOnly(date)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
}

function ctTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '??:??'
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { weekStartDate } = await request.json()
    if (!weekStartDate || typeof weekStartDate !== 'string') {
      return NextResponse.json({ error: 'weekStartDate is required (YYYY-MM-DD, Monday)' }, { status: 400 })
    }

    const startDate = dateOnly(weekStartDate)
    const endDate = addDays(startDate, 6)
    const weekEndDate = isoDate(endDate)

    const [{ data: tradesData }, { data: sessionsData }] = await Promise.all([
      supabase
        .from('trades')
        .select('*')
        .eq('user_id', user.id)
        .gte('date', weekStartDate)
        .lte('date', weekEndDate)
        .order('entry_time', { ascending: true }),
      supabase
        .from('daily_sessions')
        .select('*')
        .eq('user_id', user.id)
        .gte('date', weekStartDate)
        .lte('date', weekEndDate),
    ])

    const trades = (tradesData as Trade[]) || []
    const sessions = (sessionsData as DailySession[]) || []

    if (trades.length === 0) {
      return NextResponse.json({ error: 'No trades found for this week' }, { status: 404 })
    }

    const totalPnL = trades.reduce((s, t) => s + t.net_pnl, 0)
    const winners = trades.filter((t) => t.net_pnl > 0)
    const losers = trades.filter((t) => t.net_pnl <= 0)
    const winRate = (winners.length / trades.length) * 100

    // Group by day for context
    const byDate: Record<string, Trade[]> = {}
    for (const t of trades) {
      byDate[t.date] = byDate[t.date] || []
      byDate[t.date].push(t)
    }

    const dailySummary = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayTrades]) => {
        const dayPnL = dayTrades.reduce((s, t) => s + t.net_pnl, 0)
        const dayWins = dayTrades.filter((t) => t.net_pnl > 0).length
        const lines = dayTrades.map((t, i) =>
          `  Trade ${i + 1}: ${t.direction.toUpperCase()} ${t.quantity}x ${t.instrument || 'ES'} @ ${ctTime(t.entry_time)} CT | ` +
          `Entry ${t.entry_price} → Exit ${t.exit_price} | P&L $${t.net_pnl.toFixed(2)} | ` +
          `Setup: ${t.setup_tag || 'untagged'} | Bias: ${t.trade_bias || '?'} | Loc: ${t.trade_location || '?'} | ` +
          `Mood: ${t.mood || '?'} | Grade: ${t.grade || '?'}`,
        ).join('\n')
        return `${weekdayLabel(date)} ${date} — ${dayTrades.length} trade(s), ${dayWins}W / ${dayTrades.length - dayWins}L, Net $${dayPnL.toFixed(2)}\n${lines}`
      })
      .join('\n\n')

    const sessionContext = sessions
      .filter((s) => s.end_of_day_summary || s.pre_market_brief)
      .map((s) => {
        const parts: string[] = [`${weekdayLabel(s.date)} ${s.date}:`]
        if (s.pre_market_brief) parts.push(`  Pre-market plan: ${JSON.stringify(s.pre_market_brief)}`)
        if (s.end_of_day_summary) parts.push(`  EOD summary: ${JSON.stringify(s.end_of_day_summary)}`)
        return parts.join('\n')
      })
      .join('\n\n')

    const systemPrompt = `You are an expert ES futures trading coach reviewing a trader's week. This trader uses a strict rules-based system. Be specific — name exact rules, give percentages and dollar amounts. Avoid generic platitudes.

TRADING SYSTEM RULES:
Core Model: 1H Bias → 15m Setup → 5m Trigger
- Bull bias → longs only; Bear bias → shorts only; Neutral → retests only or no trade

Approved Time Windows (CT): 08:45–09:30 ORB primary; 09:30–10:30 continuation; 10:30–11:00 A+ only; 12:30–14:00 secondary (3 gates required); ALL other times = no trade.

Setup Priority: (1) ORB Break (2) TTM Squeeze (3) AVWAP Bounce (4) FVG Bounce (5) Divergence/Trendline Break.

Entry Rule: Break → Retest → Confirm → Enter. NEVER anticipate, blind-touch, chase, or enter on bubble/fire alone.

Approved Locations: ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight high/low, prior swing extremes, fresh supply/demand.
BANNED Locations: POC, mid-value, overlapping candles, obvious chop.

Hard Rule: Bias.Setup.Trigger.Location.Risk — all five before every trade.
Grade: A=all criteria met; B=one minor deviation; C=any rule violation.
Risk: Apex evaluation hard -$250/soft -$150, max 2 trades/day; PA hard -$150/soft -$120, max 2 trades/day; post-loss day = half base size.

Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence narrative of the week — outcome, dominant theme, what stood out",
  "system_compliance": {
    "score": <0-100 integer — % of trades that respected the full rules framework>,
    "wins": ["Specific rules followed consistently with %"],
    "violations": ["Specific rules broken with frequency and impact"]
  },
  "setup_breakdown": [
    {
      "setup": "Setup name",
      "trades": <int>,
      "win_rate": <0-100>,
      "pnl": <signed number>,
      "key_insight": "What this setup told us this week — be specific"
    }
  ],
  "emotional_trends": "Mood patterns across the week, revenge/FOMO clusters, how state evolved",
  "top_lessons": ["The 2-3 most important specific lessons from this week"],
  "next_week_focus": ["1-3 concrete rule-based behaviors to enforce next week"]
}`

    const userMessage = `Week: ${weekStartDate} → ${weekEndDate}
Total trades: ${trades.length} (${winners.length}W / ${losers.length}L), Win rate ${winRate.toFixed(1)}%, Net P&L $${totalPnL.toFixed(2)}

Trades by day:
${dailySummary}

${sessionContext ? `Daily journal context:\n${sessionContext}\n` : ''}
Generate the weekly review.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('Failed to parse weekly review response:', responseText)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    let review
    try {
      review = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in AI response' }, { status: 500 })
    }

    // Upsert
    const { data: existing } = await supabase
      .from('weekly_reviews')
      .select('id')
      .eq('user_id', user.id)
      .eq('week_start_date', weekStartDate)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('weekly_reviews')
        .update({
          week_end_date: weekEndDate,
          review,
          trade_count: trades.length,
          total_pnl: totalPnL,
        })
        .eq('id', existing.id)
    } else {
      await supabase.from('weekly_reviews').insert({
        user_id: user.id,
        week_start_date: weekStartDate,
        week_end_date: weekEndDate,
        review,
        trade_count: trades.length,
        total_pnl: totalPnL,
      })
    }

    return NextResponse.json({
      review,
      tradeCount: trades.length,
      totalPnL,
      weekStartDate,
      weekEndDate,
    })
  } catch (err) {
    console.error('Weekly review error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
