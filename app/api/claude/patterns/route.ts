export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { TRADING_SYSTEM_PROMPT } from '@/lib/trading-system'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// Structured-output schema: the API constrains decoding to this shape, so the
// reply is always parseable JSON. Mirrors the Analysis type in
// app/(app)/patterns/page.tsx. Strict mode needs every property required and
// additionalProperties:false.
const str = { type: 'string' }
const strList = { type: 'array', items: str }
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const ANALYSIS_SCHEMA = obj({
  summary: str,
  patterns: {
    type: 'array',
    items: obj({
      title: str,
      // 'timing' was removed deliberately. Structured output CONSTRAINS
      // decoding, so offering a category named "timing" alongside
      // severity:"critical" made a critical time-of-day finding a perfectly
      // well-formed response — while SESSION_TIME_POLICY in the prose asked for
      // the opposite. The schema permitted exactly what the prose forbade, and
      // a decoding constraint beats an instruction every time. With no slot to
      // put it in, a time-of-day observation has to land in 'statistical',
      // which is what the policy calls it: descriptive data, not a violation.
      // Do not re-add it without also reading SESSION_TIME_POLICY.
      type: { type: 'string', enum: ['behavioral', 'statistical', 'risk', 'system-compliance'] },
      severity: { type: 'string', enum: ['positive', 'warning', 'critical'] },
      finding: str,
      recommendation: str,
    }),
  },
  strengths: strList,
  blind_spots: strList,
  priority_focus: str,
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
      max_tokens: 16000,
      system: `You are an expert ES futures trading coach and behavioral analyst. This trader uses a strict rules-based system. Evaluate all patterns against these rules — be specific with numbers and rule references, never generic.

HARD OUTPUT CONSTRAINT — this overrides every rule below.
Entry TIME OF DAY is never a finding, never a violation, never a blind spot, never a weakness, and never affects a grade. This trader trades whenever their schedule allows; the large majority of entries fall outside 08:30-15:00 CT and that is BY DESIGN, not a deviation. Do NOT describe any entry time as prohibited, restricted, banned, off-hours, outside the window, too late, or non-compliant. Never place a time-of-day observation in blind_spots or priority_focus. Time-of-day statistics are descriptive only and belong in patterns with type "statistical".

${TRADING_SYSTEM_PROMPT}

When analyzing patterns, specifically check:
- How does performance vary by session? (Descriptive statistics only — type "statistical", never a blind spot or priority focus. See the hard output constraint above.)
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
      "type": "behavioral | statistical | risk | system-compliance",
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
      output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
    })

    // The schema guarantees valid JSON only for a reply that finished. A cut-off
    // or refused reply is still partial text, so name the cause instead of
    // letting JSON.parse surface it as a generic parse error.
    if (message.stop_reason === 'max_tokens' || message.stop_reason === 'refusal') {
      console.error('Pattern analysis stopped early:', message.stop_reason, message.usage)
      return NextResponse.json({ error: `AI response incomplete (${message.stop_reason})` }, { status: 500 })
    }

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    let analysis
    try {
      analysis = JSON.parse(text)
    } catch {
      console.error('Failed to parse Claude patterns response:', text)
      return NextResponse.json({ error: 'Invalid JSON in AI response' }, { status: 500 })
    }
    return NextResponse.json({ analysis, tradeCount: trades.length })
  } catch (err) {
    console.error('Pattern analysis error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
