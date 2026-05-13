export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { fetchPolygonNews } from '@/lib/polygon-news'
import { format } from 'date-fns'

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

    const { context, newsHeadlines: clientHeadlines } = await request.json()

    if (!context || typeof context !== 'string') {
      return NextResponse.json({ error: 'context is required' }, { status: 400 })
    }

    // Server-side news fetch: 3 s timeout, API key guard, fully non-fatal
    let newsSection = ''
    const polygonKey = process.env.POLYGON_API_KEY
    if (polygonKey) {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Polygon news timeout')), 3000)
        )
        const articles = await Promise.race([
          fetchPolygonNews({ apiKey: polygonKey, hours: 12, limit: 3 }),
          timeout,
        ])
        if (articles.length > 0) {
          newsSection =
            '\n\nRecent news headlines (last 12 hours — account for news-driven risk in your plan):\n' +
            articles
              .map((a, i) => `${i + 1}. [${a.impact}] ${a.title} — ${a.source}`)
              .join('\n')
        }
      } catch (newsErr) {
        console.error(
          'Pre-market news fetch error (non-fatal):',
          newsErr instanceof Error ? newsErr.message : newsErr
        )
        // Fall back to client-supplied headlines if available
        if (Array.isArray(clientHeadlines) && clientHeadlines.length > 0) {
          newsSection =
            '\n\nRecent news headlines (last 12 hours — account for news-driven risk in your plan):\n' +
            clientHeadlines
              .map(
                (h: { impact: string; title: string; source: string }, i: number) =>
                  `${i + 1}. [${h.impact}] ${h.title} — ${h.source}`
              )
              .join('\n')
        }
      }
    } else if (Array.isArray(clientHeadlines) && clientHeadlines.length > 0) {
      // No API key — use whatever the client already fetched
      newsSection =
        '\n\nRecent news headlines (last 12 hours — account for news-driven risk in your plan):\n' +
        clientHeadlines
          .map(
            (h: { impact: string; title: string; source: string }, i: number) =>
              `${i + 1}. [${h.impact}] ${h.title} — ${h.source}`
          )
          .join('\n')
    }

    const today = format(new Date(), 'yyyy-MM-dd')

    const systemPrompt = `You are an expert ES (S&P 500 E-mini futures) trading coach. This trader uses a specific rules-based system — evaluate everything against it.

TRADING SYSTEM RULES:
Core Model: 1H Bias → 15m Setup → 5m Trigger
- Bull bias (1H close above 21 EMA, rising) → longs only
- Bear bias (1H close below 21 EMA, falling) → shorts only
- Neutral (flat/crossing EMA) → retests only or no trade

Approved Time Windows (CT): 08:30–08:45 range build only; 08:45–09:30 ORB primary; 09:30–10:30 continuation; 10:30–11:00 A+ only; 11:00–12:30 dead zone; 12:30–14:00 secondary (verify directional morning + no macro + VWAP aligned); after 14:00 closed.

Setup Priority: (1) ORB Break (2) TTM Squeeze pullback (3) AVWAP Bounce (4) FVG Bounce (5) Divergence/Trendline Break — alert only.

Entry Rule: Break → Retest → Confirm → Enter. Never anticipate, blind-touch, or chase.

Approved Locations: ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight high/low, prior swing extremes, fresh supply/demand with confluence.
Banned Locations: POC, mid-value, overlapping candles, obvious chop.

Hard Operating Rule: Before every trade — Bias. Setup. Trigger. Location. Risk. Cannot state all five = no trade.

When generating the pre-market brief:
- Identify the 1H bias direction explicitly (Bull/Bear/Neutral) and why
- Name which of the 5 setups to watch for given today's conditions
- Build if/then scenarios using the Break→Retest→Confirm→Enter sequence
- Flag any conditions that would put the trader in the dead zone or secondary window
- What NOT to do must reference specific banned locations or banned behaviors from the system

Keep each field concise — maximum 3 sentences per field except if_then_plan which can be 5 sentences. Be sharp and direct.

Return ONLY valid JSON with these exact keys:
{
  "market_condition": "Current 1H structure and bias — be explicit: Bull/Bear/Neutral and why (EMA position, trend direction)",
  "location": "Where price is relative to key structures (VWAP, VAH/VAL, PDH/PDL, overnight levels)",
  "day_type_expectation": "Expected day type — reference which setups are most likely valid today",
  "key_levels": "Critical price levels for ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight extremes",
  "if_then_plan": "2-3 specific if/then scenarios using Break→Retest→Confirm→Enter format with exact levels",
  "what_not_to_do": "Specific banned behaviors for today — reference POC/mid-value/chop locations and time window rules",
  "risk_level": "Low | Normal | High — with specific reason referencing today's structure"
}

Respond with raw JSON only. Do not wrap in markdown code fences. Do not include \`\`\`json or \`\`\`. Start your response directly with { and end with }.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Today is ${today}. Here are my pre-market observations:\n\n${context}${newsSection}\n\nGenerate my pre-market brief.`,
        },
      ],
    })

    const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

    const extractField = (text: string, field: string): string => {
      const match = text.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's'))
      return match ? match[1] : ''
    }

    let brief
    try {
      const cleaned = responseText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .replace(/^\s*\{/, '{')
        .trim()
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      brief = JSON.parse(jsonMatch[0])
    } catch {
      console.error('Failed to parse Claude pre-market response (attempting field extraction):', responseText)
      // Truncated or malformed JSON — extract each field individually
      brief = {
        market_condition:      extractField(responseText, 'market_condition'),
        location:              extractField(responseText, 'location'),
        day_type_expectation:  extractField(responseText, 'day_type_expectation'),
        key_levels:            extractField(responseText, 'key_levels'),
        if_then_plan:          extractField(responseText, 'if_then_plan'),
        what_not_to_do:        extractField(responseText, 'what_not_to_do'),
        risk_level:            extractField(responseText, 'risk_level'),
      }
      // If every field is empty the response was truly unusable
      const hasContent = Object.values(brief).some((v) => v.length > 0)
      if (!hasContent) {
        return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
      }
    }

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
