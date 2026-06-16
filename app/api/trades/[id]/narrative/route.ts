export const dynamic = 'force-dynamic'
export const maxDuration = 45

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { Trade, PlaybookSetup } from '@/types'
import { classifyWindow, ctTimeLabel, isNoTradeWindow, WINDOW_LABEL } from '@/lib/trade-flags'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

function ctMins(entryTime: string): number | null {
  try {
    const s = new Date(entryTime).toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
    const [h, m] = s.split(':').map(Number)
    return h * 60 + m
  } catch {
    return null
  }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: tradeData, error: tradeErr } = await supabase
      .from('trades')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single()

    if (tradeErr || !tradeData) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }
    const trade = tradeData as Trade

    // Pull the playbook setup if one is tagged so the AI can compare against the user's own criteria.
    let playbookSetup: PlaybookSetup | null = null
    if (trade.setup_tag) {
      const { data: setupData } = await supabase
        .from('playbook_setups')
        .select('*')
        .eq('user_id', user.id)
        .eq('name', trade.setup_tag)
        .maybeSingle()
      if (setupData) playbookSetup = setupData as PlaybookSetup
    }

    const mins = ctMins(trade.entry_time)
    const windowStatus = mins !== null ? classifyWindow(mins) : 'unknown'
    const ctEntry = ctTimeLabel(trade.entry_time) ?? '??:??'
    const ctExit = ctTimeLabel(trade.exit_time) ?? '??:??'

    const directionPoints = trade.direction === 'long'
      ? trade.exit_price - trade.entry_price
      : trade.entry_price - trade.exit_price

    const stopDistance = trade.stop_loss !== null ? Math.abs(trade.entry_price - trade.stop_loss) : null
    const targetDistance = trade.target !== null ? Math.abs(trade.target - trade.entry_price) : null
    const rMultiple = stopDistance && stopDistance > 0 ? directionPoints / stopDistance : null

    const newsLines = (trade.news_articles || []).map((n) =>
      `  - [${n.impact}] ${n.title} (${n.source}, ${n.publishedAt})`,
    ).join('\n')

    const factsBlock = [
      `Trade ID: ${trade.id}`,
      `Date: ${trade.date}`,
      `Instrument: ${trade.instrument || 'ES'}`,
      `Direction: ${trade.direction.toUpperCase()}`,
      `Quantity: ${trade.quantity}`,
      `Entry: ${trade.entry_price} at ${ctEntry} CT`,
      `Exit: ${trade.exit_price} at ${ctExit} CT`,
      `Move: ${directionPoints.toFixed(2)} pts (${directionPoints >= 0 ? 'with' : 'against'} direction)`,
      `Net P&L: $${trade.net_pnl.toFixed(2)} (gross $${trade.gross_pnl.toFixed(2)}, commission $${trade.commission.toFixed(2)})`,
      `Stop loss: ${trade.stop_loss !== null ? `${trade.stop_loss} (${stopDistance?.toFixed(2)} pts risk)` : 'NOT SET'}`,
      `Target: ${trade.target !== null ? `${trade.target} (${targetDistance?.toFixed(2)} pts reward)` : 'NOT SET'}`,
      `Planned R:R: ${stopDistance && targetDistance ? (targetDistance / stopDistance).toFixed(2) : '—'}`,
      `Realized R: ${rMultiple !== null ? `${rMultiple.toFixed(2)}R` : '—'}`,
      `MAE: ${trade.mae !== null ? `${trade.mae.toFixed(2)} pts (max adverse)` : 'not recorded'}`,
      `MFE: ${trade.mfe !== null ? `${trade.mfe.toFixed(2)} pts (max favorable)` : 'not recorded'}`,
      `Time window: ${WINDOW_LABEL[windowStatus]}${isNoTradeWindow(windowStatus) ? ' (NO-TRADE window — range build or stand-down, should not have entered here)' : ''}`,
      `Setup tag: ${trade.setup_tag || 'untagged'}`,
      `1H bias recorded: ${trade.trade_bias || 'not recorded'}`,
      `Location: ${trade.trade_location || 'not recorded'}`,
      `Trigger: ${trade.trade_trigger || 'not recorded'}`,
      `Risk plan: ${trade.trade_risk || 'not recorded'}`,
      `Mood: ${trade.mood || 'untagged'}`,
      `Grade: ${trade.grade || 'ungraded'}`,
      trade.notes ? `Notes: ${trade.notes}` : '',
      trade.reflection ? `Reflection: ${trade.reflection}` : '',
      newsLines ? `High-impact news within 15min of entry:\n${newsLines}` : '',
    ].filter(Boolean).join('\n')

    const playbookBlock = playbookSetup
      ? `Trader's playbook for "${playbookSetup.name}":\nDescription: ${playbookSetup.description || '(none)'}\nEntry criteria: ${playbookSetup.entry_criteria || '(none)'}\nExit criteria: ${playbookSetup.exit_criteria || '(none)'}`
      : '(No playbook setup tagged — cannot compare to written entry/exit criteria.)'

    const systemPrompt = `You are an expert ES futures trading coach reviewing a single trade. This trader uses a strict rules-based system — evaluate the trade against it precisely.

TRADING SYSTEM RULES:
Core Model: 1H Bias → 15m Setup → 5m Trigger
- Bull bias → longs only; Bear bias → shorts only; Neutral → retests only or no trade

Approved Time Windows (CT) — ORB replays at each session open: Tokyo 19:15–20:00; Shanghai 20:45–21:30; London 02:15–03:00; NY 08:45–09:30 ORB primary → 09:30–10:30 continuation → 10:30–11:00 A+ only → 12:30–14:00 secondary (3 gates). All other extended-hours time is tradeable but secondary (thinner liquidity); the session ORBs and NY RTH are prime.
NO-TRADE Windows: the 15-min OR build before each open (Tokyo 19:00–19:15, Shanghai 20:30–20:45, London 02:00–02:15, NY 08:30–08:45) and the NY lunch dead zone 11:00–12:30.

Setup Priority: (1) ORB Break (2) TTM Squeeze (3) AVWAP Bounce (4) FVG Bounce (5) Divergence/Trendline Break (alert only).

Entry Rule: Break → Retest → Confirm → Enter. NEVER anticipate, blind-touch, chase, or enter on fire alone.

Approved Locations: ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight high/low, prior swing extremes, fresh supply/demand.
BANNED Locations: POC, mid-value, overlapping candles, obvious chop.

Hard Operating Rule: Bias.Setup.Trigger.Location.Risk — all five must be defined before entering.
Grade: A=all criteria met; B=one minor deviation; C=any rule violation.

Write a tight, second-person narrative (≈100-150 words) of this single trade — what the trader did, whether it respected the rules, what the MFE/MAE pattern reveals (did you get out too early, sit through too much heat, etc.). Be specific with numbers. Don't moralize; be coach-direct.

Return ONLY valid JSON in this exact structure:
{
  "narrative": "The full narrative paragraph (second-person, ~100-150 words, includes specific numbers and rule references)",
  "what_went_right": ["Specific rule followed or good behavior (2-4 items, blank array if nothing)"],
  "what_went_wrong": ["Specific rule violated or mistake (2-4 items, blank array if nothing)"],
  "key_lesson": "Single most actionable takeaway for this trader's next session"
}`

    const userMessage = `Trade facts:
${factsBlock}

${playbookBlock}

Write the narrative for this trade.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
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
      console.error('Failed to parse narrative response:', responseText)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    let parsed: { narrative: string; what_went_right: string[]; what_went_wrong: string[]; key_lesson: string }
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in AI response' }, { status: 500 })
    }

    const narrative = {
      narrative: parsed.narrative,
      what_went_right: parsed.what_went_right || [],
      what_went_wrong: parsed.what_went_wrong || [],
      key_lesson: parsed.key_lesson,
      generated_at: new Date().toISOString(),
    }

    await supabase
      .from('trades')
      .update({ ai_narrative: narrative })
      .eq('id', trade.id)

    return NextResponse.json({ narrative })
  } catch (err) {
    console.error('Trade narrative error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
