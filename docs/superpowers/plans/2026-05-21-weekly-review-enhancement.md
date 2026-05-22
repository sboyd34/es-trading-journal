# Weekly Review Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate the weekly Claude debrief every Friday via Vercel cron and surface a day-by-day discipline score trend inside the review.

**Architecture:** Add `discipline_trend` to the `WeeklyReviewContent` type; enhance the existing `/api/claude/weekly-review` route to include discipline scores in the Claude prompt and to accept cron-auth (CRON_SECRET header + userId in body); create a new `/api/cron/weekly-review` GET route that fires every Friday at 21:00 UTC; add a `DisciplineTrendSection` UI component between the system compliance card and the setup breakdown on the weekly review page.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase service role client, Anthropic claude-sonnet-4-6, Tailwind CSS, Vercel cron (vercel.json)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `types/index.ts` | Add `discipline_trend?` to `WeeklyReviewContent` |
| Modify | `app/api/claude/weekly-review/route.ts` | Add discipline prompt section, cron auth path, return `discipline_trend` |
| Create | `app/api/cron/weekly-review/route.ts` | Cron entry point — check, skip if exists, call weekly review API |
| Modify | `vercel.json` | Register the Friday cron schedule |
| Modify | `app/(app)/weekly-review/page.tsx` | Auto-generate note + `DisciplineTrendSection` component |

---

### Task 1: Add `discipline_trend` to `WeeklyReviewContent`

**Files:**
- Modify: `types/index.ts` (lines 201–218 — the `WeeklyReviewContent` interface)

The field is optional (`?`) so existing stored reviews that predate this change still render without error.

- [ ] **Step 1: Open `types/index.ts` and find `WeeklyReviewContent`**

Current interface (lines 201–218):
```ts
export interface WeeklyReviewContent {
  summary: string
  system_compliance: {
    score: number
    wins: string[]
    violations: string[]
  }
  setup_breakdown: Array<{
    setup: string
    trades: number
    win_rate: number
    pnl: number
    key_insight: string
  }>
  emotional_trends: string
  top_lessons: string[]
  next_week_focus: string[]
}
```

- [ ] **Step 2: Add `discipline_trend?` field**

Replace the `WeeklyReviewContent` interface with:
```ts
export interface WeeklyReviewContent {
  summary: string
  system_compliance: {
    score: number
    wins: string[]
    violations: string[]
  }
  setup_breakdown: Array<{
    setup: string
    trades: number
    win_rate: number
    pnl: number
    key_insight: string
  }>
  emotional_trends: string
  discipline_trend?: {
    days: Array<{ date: string; score: number | null }>
    narrative: string
  }
  top_lessons: string[]
  next_week_focus: string[]
}
```

- [ ] **Step 3: Type-check**

```bash
cd ~/es-trading-journal && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "$(cat <<'EOF'
Types: add discipline_trend to WeeklyReviewContent

Optional field so existing stored reviews without it don't break.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Enhance `/api/claude/weekly-review/route.ts`

**Files:**
- Modify: `app/api/claude/weekly-review/route.ts` (full file replacement)

Two additions: (1) secondary auth path for cron callers, (2) discipline scores injected into the Claude prompt + `discipline_trend` added to the JSON spec Claude must return.

- [ ] **Step 1: Understand the current auth model**

The route currently calls `supabase.auth.getUser()` (cookie auth). When called from the cron route, there is no cookie — instead the cron passes `Authorization: Bearer <CRON_SECRET>` and `userId` in the request body. We parse the body **first** (before auth) then branch.

- [ ] **Step 2: Replace `app/api/claude/weekly-review/route.ts` with the updated version**

```ts
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { Trade, DailySession } from '@/types'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

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
    // Parse body first — needed for both auth paths.
    const body = await request.json()
    const { weekStartDate, userId: cronUserId } = body

    if (!weekStartDate || typeof weekStartDate !== 'string') {
      return NextResponse.json({ error: 'weekStartDate is required (YYYY-MM-DD, Monday)' }, { status: 400 })
    }

    // Auth: cron path uses CRON_SECRET header + userId in body.
    // Browser path uses cookie session.
    let userId: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let supabase: any

    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get('authorization')

    if (cronSecret && authHeader === `Bearer ${cronSecret}` && typeof cronUserId === 'string') {
      userId = cronUserId
      supabase = createServiceClient()
    } else {
      const cookieClient = await createClient()
      const { data: { user } } = await cookieClient.auth.getUser()
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      userId = user.id
      supabase = cookieClient
    }

    const startDate = dateOnly(weekStartDate)
    const endDate = addDays(startDate, 6)
    const weekEndDate = isoDate(endDate)

    const [{ data: tradesData }, { data: sessionsData }] = await Promise.all([
      supabase
        .from('trades')
        .select('*')
        .eq('user_id', userId)
        .gte('date', weekStartDate)
        .lte('date', weekEndDate)
        .order('entry_time', { ascending: true }),
      supabase
        .from('daily_sessions')
        .select('*')
        .eq('user_id', userId)
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

    // Build discipline score section for the prompt.
    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    const disciplineLines = DAY_LABELS.map((label, i) => {
      const dayDate = isoDate(addDays(startDate, i))
      const session = sessions.find((s) => s.date === dayDate)
      const score = session?.discipline_score ?? null
      const bd = session?.discipline_breakdown
      if (score === null) return `${label} ${dayDate.slice(5).replace('-', '/')}: null`
      const bdStr = bd
        ? `  (setup ${bd.setup}, emotion ${bd.emotion}, prep ${bd.prep}, grade ${bd.grade})`
        : ''
      return `${label} ${dayDate.slice(5).replace('-', '/')}: ${score}${bdStr}`
    })
    const scoredSessions = sessions.filter((s) => s.discipline_score !== null)
    const weekAvgScore = scoredSessions.length > 0
      ? (scoredSessions.reduce((sum, s) => sum + (s.discipline_score ?? 0), 0) / scoredSessions.length).toFixed(1)
      : null
    const disciplineSection = [
      'Discipline scores this week (0-100, null = no trades or score not recorded):',
      ...disciplineLines,
      weekAvgScore ? `Weekly avg: ${weekAvgScore}` : 'Weekly avg: N/A (no scores recorded)',
    ].join('\n')

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
  "discipline_trend": {
    "days": [
      {"date": "YYYY-MM-DD", "score": <number or null>}
    ],
    "narrative": "2-3 sentences on what the trend shows, what drove any dips, whether discipline is improving or slipping"
  },
  "top_lessons": ["The 2-3 most important specific lessons from this week"],
  "next_week_focus": ["1-3 concrete rule-based behaviors to enforce next week"]
}`

    const userMessage = `Week: ${weekStartDate} → ${weekEndDate}
Total trades: ${trades.length} (${winners.length}W / ${losers.length}L), Win rate ${winRate.toFixed(1)}%, Net P&L $${totalPnL.toFixed(2)}

Trades by day:
${dailySummary}

${disciplineSection}

${sessionContext ? `Daily journal context:\n${sessionContext}\n` : ''}
Generate the weekly review.`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2800,
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

    const { data: existing } = await supabase
      .from('weekly_reviews')
      .select('id')
      .eq('user_id', userId)
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
        user_id: userId,
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
```

- [ ] **Step 3: Type-check**

```bash
cd ~/es-trading-journal && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/claude/weekly-review/route.ts
git commit -m "$(cat <<'EOF'
API: add discipline scores to weekly review prompt + cron auth path

- Day-by-day discipline scores (with breakdown) injected into Claude prompt
- discipline_trend field added to Claude JSON spec
- Secondary auth path: CRON_SECRET header + userId body param bypasses cookie auth

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create `/api/cron/weekly-review/route.ts`

**Files:**
- Create: `app/api/cron/weekly-review/route.ts`

This is a GET route (Vercel cron uses GET). It guards with CRON_SECRET, computes Monday of the current week, skips if a review already exists, then calls the weekly review API route.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p ~/es-trading-journal/app/api/cron/weekly-review
```

- [ ] **Step 2: Create `app/api/cron/weekly-review/route.ts`**

```ts
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

function thisWeekMonday(): string {
  const now = new Date()
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = utc.getUTCDay() // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day
  utc.setUTCDate(utc.getUTCDate() + diff)
  return utc.toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const weekStartDate = thisWeekMonday()

  // Look up the single user in this app.
  const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers()
  if (usersError || !users?.length) {
    return NextResponse.json({ error: 'Could not load users' }, { status: 500 })
  }
  const userId = users[0].id

  // Skip if a review already exists for this week (don't overwrite manual runs).
  const { data: existing } = await supabase
    .from('weekly_reviews')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ message: 'Review already exists for this week — skipped', weekStartDate })
  }

  // Derive the base URL from the request host so it works on any deployment.
  const { origin } = new URL(request.url)
  const res = await fetch(`${origin}/api/claude/weekly-review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cronSecret ?? ''}`,
    },
    body: JSON.stringify({ weekStartDate, userId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[cron/weekly-review] generation failed', err)
    return NextResponse.json({ error: 'Weekly review generation failed', detail: err }, { status: 500 })
  }

  const data = await res.json()
  return NextResponse.json({ generated: true, weekStartDate, tradeCount: data.tradeCount })
}
```

- [ ] **Step 3: Type-check**

```bash
cd ~/es-trading-journal && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/weekly-review/route.ts
git commit -m "$(cat <<'EOF'
Cron: add weekly review auto-generation route

Fires every Friday at 21:00 UTC. Guards with CRON_SECRET, skips if a
review already exists for the week to protect manual runs.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Register the cron in `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Update `vercel.json`**

Current content:
```json
{
  "crons": [
    {
      "path": "/api/tradovate/cron",
      "schedule": "30 14 * * 1-5"
    }
  ]
}
```

New content (add weekly review cron — Fridays 21:00 UTC = 15:00 CT after session close):
```json
{
  "crons": [
    {
      "path": "/api/tradovate/cron",
      "schedule": "30 14 * * 1-5"
    },
    {
      "path": "/api/cron/weekly-review",
      "schedule": "0 21 * * 5"
    }
  ]
}
```

- [ ] **Step 2: Type-check**

```bash
cd ~/es-trading-journal && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "$(cat <<'EOF'
Config: register weekly review cron — Fridays 21:00 UTC

Schedule: 0 21 * * 5 (every Friday at 21:00 UTC = 15:00 CT after market close)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update the weekly review page

**Files:**
- Modify: `app/(app)/weekly-review/page.tsx`

Two changes: (1) replace the "Claude will analyze..." subtitle with "Generates automatically Friday after close" when no review exists; (2) add a new `DisciplineTrendSection` component between `ComplianceCard` and the setup breakdown, rendered only when `discipline_trend` is present.

- [ ] **Step 1: Add the `Trending` Lucide icon import**

At the top of `app/(app)/weekly-review/page.tsx`, the existing imports include:
```ts
import {
  Sparkles,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Lightbulb,
  Target,
  Heart,
  BarChart3,
} from 'lucide-react'
```

Replace with (add `TrendingUp`):
```ts
import {
  Sparkles,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Lightbulb,
  Target,
  Heart,
  BarChart3,
  TrendingUp,
} from 'lucide-react'
```

- [ ] **Step 2: Change the auto-generate subtitle**

Find this block (around line 274–278):
```tsx
<p className="text-xs text-gray-400 mt-0.5">
  {review
    ? `Generated ${new Date(review.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
    : 'Claude will analyze every trade against your rules framework.'}
</p>
```

Replace with:
```tsx
<p className="text-xs text-gray-400 mt-0.5">
  {review
    ? `Generated ${new Date(review.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
    : 'Generates automatically Friday after close'}
</p>
```

- [ ] **Step 3: Insert `DisciplineTrendSection` between compliance and setup breakdown**

Find this block (around line 303–307):
```tsx
{/* Compliance score */}
<ComplianceCard compliance={review.review.system_compliance} />

{/* Setup breakdown */}
{review.review.setup_breakdown?.length > 0 && (
```

Replace with:
```tsx
{/* Compliance score */}
<ComplianceCard compliance={review.review.system_compliance} />

{/* Discipline trend */}
{review.review.discipline_trend && (
  <DisciplineTrendSection trend={review.review.discipline_trend} />
)}

{/* Setup breakdown */}
{review.review.setup_breakdown?.length > 0 && (
```

- [ ] **Step 4: Add the `DisciplineTrendSection` component at the bottom of the file**

After the closing `}` of `ComplianceCard` (around line 452), add:

```tsx
function DisciplineTrendSection({
  trend,
}: {
  trend: { days: Array<{ date: string; score: number | null }>; narrative: string }
}) {
  const nonNull = trend.days.filter((d) => d.score !== null)
  const avg =
    nonNull.length > 0
      ? (nonNull.reduce((s, d) => s + (d.score ?? 0), 0) / nonNull.length).toFixed(1)
      : null

  function dayLabel(dateStr: string): string {
    const parts = dateStr.split('-').map(Number)
    const d = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1))
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  }

  function chipStyle(score: number | null): string {
    if (score === null) return 'border-gray-700 bg-gray-800/40 text-gray-600'
    if (score >= 90) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
    if (score >= 70) return 'border-amber-500/40 bg-amber-500/10 text-amber-400'
    return 'border-red-500/40 bg-red-500/10 text-red-400'
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-purple-400" />
          Discipline Trend
        </h2>
        {avg && (
          <span className="text-xs text-gray-400">
            Weekly avg:{' '}
            <span className={cn(
              'font-semibold',
              parseFloat(avg) >= 90 ? 'text-emerald-400' : parseFloat(avg) >= 70 ? 'text-amber-400' : 'text-red-400',
            )}>
              {avg}
            </span>
          </span>
        )}
      </div>

      {/* Day chips */}
      <div className="flex gap-2 flex-wrap mb-4">
        {trend.days.map((d) => (
          <div
            key={d.date}
            className={cn('flex flex-col items-center px-3 py-2 rounded-lg border text-center min-w-[54px]', chipStyle(d.score))}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{dayLabel(d.date)}</span>
            <span className="text-sm font-bold mt-0.5">{d.score !== null ? d.score : '—'}</span>
          </div>
        ))}
      </div>

      {/* Claude's narrative */}
      <p className="text-sm text-gray-300 leading-relaxed">{trend.narrative}</p>
    </div>
  )
}
```

- [ ] **Step 5: Type-check**

```bash
cd ~/es-trading-journal && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Build check**

```bash
cd ~/es-trading-journal && npm run build
```
Expected: clean build, no type errors or lint warnings.

- [ ] **Step 7: Manual verification**

```bash
cd ~/es-trading-journal && npm run dev
```

1. Open `http://localhost:3000/weekly-review` in the browser
2. Navigate to a week **without** a review — confirm subtitle reads "Generates automatically Friday after close" (not the old "Claude will analyze..." text)
3. Click "Generate Review" on a week that has trades — confirm the review generates and `DisciplineTrendSection` appears between System Compliance and Setup Breakdown
4. Confirm day chips show Mon/Tue/Wed/Thu/Fri with correct colors (green ≥90, amber ≥70, red <70, gray "—" for null)
5. Confirm the narrative paragraph renders below the chips

- [ ] **Step 8: Commit**

```bash
git add app/(app)/weekly-review/page.tsx
git commit -m "$(cat <<'EOF'
UI: add DisciplineTrend section + auto-generate note to weekly review

- 'Generates automatically Friday after close' replaces the old manual-action prompt
- DisciplineTrendSection renders between compliance card and setup breakdown
- Color-coded day chips: emerald ≥90, amber ≥70, red <70, gray null
- Shows weekly average and Claude's narrative on the trend

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Push and verify

- [ ] **Push to production**

```bash
git push origin main
```

Vercel auto-deploys. After deploy, confirm on `https://es-trading-journal.vercel.app/weekly-review` that the page renders as expected.

- [ ] **Smoke-test the cron endpoint manually** (optional)

```bash
curl -X GET https://es-trading-journal.vercel.app/api/cron/weekly-review \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Expected responses:
- If no review exists for this week: `{"generated":true,"weekStartDate":"...","tradeCount":<n>}`
- If review already exists: `{"message":"Review already exists for this week — skipped","weekStartDate":"..."}`
- If no trades this week: the inner API returns 404 and the cron returns a 500 with `"Weekly review generation failed"`
