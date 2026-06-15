export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_time', { ascending: true })

    if (!trades || trades.length < 5) {
      return NextResponse.json({ error: 'Need at least 5 trades for pattern analysis' }, { status: 400 })
    }

    const tradeSummary = trades.map((t) => ({
      date: t.date,
      time: t.entry_time?.slice(11, 16),
      direction: t.direction,
      qty: t.quantity,
      entry: t.entry_price,
      exit: t.exit_price,
      net_pnl: t.net_pnl,
      mood: t.mood,
      grade: t.grade,
      setup: t.setup_tag,
      notes: t.notes,
      stop: t.stop_loss,
      target: t.target,
      mae: t.mae,
      mfe: t.mfe,
      tags: t.tags,
    }))

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: `You are an expert ES futures trading coach and behavioral analyst. This trader uses a strict rules-based system. Evaluate all patterns against these rules — be specific with numbers and rule references, never generic.

TRADING SYSTEM RULES:
Core Model: 1H Bias → 15m Setup → 5m Trigger (Bull=longs only, Bear=shorts only, Neutral=retests only)
Time Windows (CT): 08:45–09:30 ORB primary; 09:30–10:30 continuation; 10:30–11:00 A+ only; 12:30–14:00 secondary (3 gates); all other times = no trade.
Setups (priority order): (1) ORB Break (2) TTM Squeeze (3) AVWAP Bounce (4) FVG Bounce (5) Divergence/Trendline Break.
Entry Rule: Break→Retest→Confirm→Enter. Never anticipate/chase/blind-touch/enter on fire alone.
Approved Locations: ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight high/low, prior swing extremes, fresh supply/demand.
BANNED Locations: POC, mid-value, overlapping candles, chop.
Hard Rule: Bias.Setup.Trigger.Location.Risk — all five before every trade.
Grade: A=all criteria met; B=one minor deviation; C=any rule violation.
Risk: Evaluation hard stop -$250/soft -$150; PA hard -$150/soft -$120.

When analyzing patterns, specifically check:
- What percentage of trades are during approved vs banned time windows?
- Which setups have the best/worst win rates? Are lower-priority setups being over-traded?
- Are there entries at banned locations (POC, mid-value, chop)? Name them.
- Is the Break→Retest→Confirm→Enter sequence being followed? What % skip steps?
- Are trades in the correct direction for the stated bias?
- Are C-grade trades clustering around specific times, setups, or moods?
- Is size discipline being maintained per Apex rules?

Return ONLY valid JSON with this structure:
{
  "summary": "2-3 sentence profile referencing this trader's specific system compliance rate",
  "patterns": [
    {
      "title": "Pattern name",
      "type": "behavioral | statistical | timing | risk | system-compliance",
      "severity": "positive | warning | critical",
      "finding": "Specific finding with exact numbers and rule reference",
      "recommendation": "Concrete rule-based action to take"
    }
  ],
  "strengths": ["Specific system rule being followed consistently with %"],
  "blind_spots": ["Specific system rule being violated with frequency"],
  "priority_focus": "The single most important system rule to enforce — reference the exact rule"
}`,
      messages: [
        {
          role: 'user',
          content: `Analyze my ${trades.length} ES futures trades:\n\n${JSON.stringify(tradeSummary, null, 2)}\n\nIdentify behavioral and statistical patterns. Be specific with percentages and dollar amounts.`,
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('Failed to parse Claude patterns response:', text)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    const analysis = JSON.parse(jsonMatch[0])
    return NextResponse.json({ analysis, tradeCount: trades.length })
  } catch (err) {
    console.error('Pattern analysis error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
