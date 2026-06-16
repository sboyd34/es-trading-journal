import Anthropic from '@anthropic-ai/sdk'
import { fetchPolygonNews } from '@/lib/polygon-news'
import { fetchUpcomingEarnings } from '@/lib/finnhub-earnings'
import { getMacroEventsForDate, hasSecondaryWindowConflict } from '@/lib/econ-calendar'
import { formatEdgeStatsSection, type EdgeStat } from '@/lib/edge-stats'
import { format } from 'date-fns'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export interface PreMarketBrief {
  market_condition: string
  location: string
  day_type_expectation: string
  key_levels: string
  if_then_plan: string
  what_not_to_do: string
  risk_level: string
}

type Headline = { impact: string; title: string; source: string }

const SYSTEM_PROMPT = `You are an expert ES (S&P 500 E-mini futures) trading coach. This trader uses a specific rules-based system — evaluate everything against it.

TRADING SYSTEM RULES:
Core Model: 1H Bias → 15m Setup → 5m Trigger
- Bull bias (1H close above 21 EMA, rising) → longs only
- Bear bias (1H close below 21 EMA, falling) → shorts only
- Neutral (flat/crossing EMA) → retests only or no trade

Approved Time Windows (CT) — ORB replays at each session open: Tokyo 19:00–19:15 build → 19:15–20:00 ORB; Shanghai 20:30–20:45 build → 20:45–21:30 ORB; London 02:00–02:15 build → 02:15–03:00 ORB; NY 08:30–08:45 build → 08:45–09:30 ORB primary → 09:30–10:30 continuation → 10:30–11:00 A+ only → 11:00–12:30 dead zone → 12:30–14:00 secondary (directional morning + no macro + VWAP aligned). All other extended-hours time is tradeable but secondary (thinner liquidity); the session ORBs and NY RTH are prime.

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
- If scheduled macro events are listed, fold them into the plan: elevate risk_level around HIGH-impact prints, and in what_not_to_do warn against fading the first impulse off an 07:30 CT release — let the NY ORB build finish before committing. If the list says the 12:30–14:00 secondary window is CLOSED (a macro event hits 12:00–14:30 CT, e.g. FOMC), say so explicitly in if_then_plan and what_not_to_do.
- If watchlist earnings are listed, fold them in: a Mag 7 or large-cap BMO print can whip the cash open, so elevate risk_level and warn in what_not_to_do against committing to the NY ORB before the earnings reaction settles. An AMC print is afternoon and overnight risk — flag it for the 12:30–14:00 secondary window and caution against carrying size into the close.
- If a personal edge table is provided, weave the rows matching today's bias into market_condition, day_type_expectation, and what_not_to_do. Treat a weak personal record on an approved setup as "demand A+ confluence / size down," never as a ban — the system's setup list still governs. Soften any row tagged [thin sample] to directional language; never quote a hard win rate off a thin sample.
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

function formatHeadlines(headlines: Headline[]): string {
  return (
    '\n\nRecent news headlines (last 12 hours — account for news-driven risk in your plan):\n' +
    headlines.map((h, i) => `${i + 1}. [${h.impact}] ${h.title} — ${h.source}`).join('\n')
  )
}

// Server-side news fetch: 3 s timeout, API key guard, fully non-fatal.
// Falls back to client-supplied headlines when the live fetch fails or no key is set.
async function buildNewsSection(clientHeadlines?: Headline[]): Promise<string> {
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
        return formatHeadlines(
          articles.map((a) => ({ impact: a.impact, title: a.title, source: a.source }))
        )
      }
    } catch (newsErr) {
      console.error(
        'Pre-market news fetch error (non-fatal):',
        newsErr instanceof Error ? newsErr.message : newsErr
      )
      if (Array.isArray(clientHeadlines) && clientHeadlines.length > 0) {
        return formatHeadlines(clientHeadlines)
      }
    }
  } else if (Array.isArray(clientHeadlines) && clientHeadlines.length > 0) {
    return formatHeadlines(clientHeadlines)
  }
  return ''
}

// Today's scheduled high-impact federal macro events, formatted for the prompt.
// Always emitted (even when empty) so Claude knows the calendar was checked and
// can state "no scheduled macro" rather than guessing.
function formatMacroSection(today: string): string {
  const events = getMacroEventsForDate(today)
  if (events.length === 0) {
    return '\n\nScheduled US macro events today: none on the federal calendar.'
  }
  const lines = events
    .map((e) => `- ${e.ctTime} CT [${e.impact}] ${e.name}`)
    .join('\n')
  const gate = hasSecondaryWindowConflict(today)
    ? '\nA macro event falls in 12:00–14:30 CT — the 12:30–14:00 NY secondary window gate is CLOSED today.'
    : ''
  return `\n\nScheduled US macro events today (America/Chicago):\n${lines}${gate}`
}

// Today's watchlist earnings (Mag 7 + financials), formatted for the prompt.
// Self-contained server-side fetch — 3s timeout, API-key guard, fully non-fatal —
// so both brief callers inherit it without plumbing. Emits "none scheduled" only
// when the fetch succeeded and was empty; stays silent when we couldn't check.
async function buildEarningsSection(today: string): Promise<string> {
  const finnhubKey = process.env.FINNHUB_API_KEY
  if (!finnhubKey) return ''
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Finnhub earnings timeout')), 3000)
    )
    const events = await Promise.race([
      fetchUpcomingEarnings({ apiKey: finnhubKey, days: 1 }),
      timeout,
    ])
    const todays = events.filter((e) => e.date === today)
    if (todays.length === 0) {
      return '\n\nWatchlist earnings today: none scheduled.'
    }
    const lines = todays
      .map((e) => {
        const eps = e.epsEstimate !== null ? ` (EPS est ${e.epsEstimate})` : ''
        return `- ${e.symbol} [${e.hourLabel}]${eps}`
      })
      .join('\n')
    return `\n\nWatchlist earnings today (Mag 7 + financials):\n${lines}`
  } catch (earningsErr) {
    console.error(
      'Pre-market earnings fetch error (non-fatal):',
      earningsErr instanceof Error ? earningsErr.message : earningsErr
    )
    return ''
  }
}

/**
 * Generate the structured pre-market brief from a freeform context string.
 * Shared by the manual "Generate Brief" button and the morning auto-import.
 * Returns null only when Claude's response is wholly unusable (no field parsed).
 */
export async function generatePreMarketBrief(
  context: string,
  clientHeadlines?: Headline[],
  edgeStats?: EdgeStat[]
): Promise<PreMarketBrief | null> {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [newsSection, earningsSection] = await Promise.all([
    buildNewsSection(clientHeadlines),
    buildEarningsSection(today),
  ])
  const macroSection = formatMacroSection(today)
  const edgeSection = formatEdgeStatsSection(edgeStats ?? [])

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Today is ${today}. Here are my pre-market observations:\n\n${context}${newsSection}${macroSection}${earningsSection}${edgeSection}\n\nGenerate my pre-market brief.`,
      },
    ],
  })

  const responseText = message.content[0].type === 'text' ? message.content[0].text : ''

  const extractField = (text: string, field: string): string => {
    const match = text.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's'))
    return match ? match[1] : ''
  }

  try {
    const cleaned = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .replace(/^\s*\{/, '{')
      .trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    return JSON.parse(jsonMatch[0]) as PreMarketBrief
  } catch {
    console.error(
      'Failed to parse Claude pre-market response (attempting field extraction):',
      responseText
    )
    // Truncated or malformed JSON — extract each field individually
    const brief: PreMarketBrief = {
      market_condition: extractField(responseText, 'market_condition'),
      location: extractField(responseText, 'location'),
      day_type_expectation: extractField(responseText, 'day_type_expectation'),
      key_levels: extractField(responseText, 'key_levels'),
      if_then_plan: extractField(responseText, 'if_then_plan'),
      what_not_to_do: extractField(responseText, 'what_not_to_do'),
      risk_level: extractField(responseText, 'risk_level'),
    }
    const hasContent = Object.values(brief).some((v) => v.length > 0)
    return hasContent ? brief : null
  }
}
