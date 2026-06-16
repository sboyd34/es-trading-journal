# Personal Edge Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the trader's all-time `(bias × setup)` win/loss/$ record into the pre-market brief so Claude's plan reflects what actually works for the trader, not just what the system permits.

**Architecture:** A new pure module `lib/edge-stats.ts` buckets trades by bias × setup (mirroring `FiveWordGateModal`'s matching semantics) and formats a prompt section. The shared `generatePreMarketBrief()` gains an optional `edgeStats` param appended to the LLM prompt. Both brief callers (manual route + morning auto-import) fetch trades and pass the computed stats in.

**Tech Stack:** Next.js 14, TypeScript, Supabase (`@supabase/ssr` + service client), Anthropic SDK.

**QA model (important):** This repo has **no test runner** (CLAUDE.md: manual verification + `npm run build` is the gating check). There is no `tsx`/`ts-node`. So each task verifies via `npm run build` (lint + type-check + compile, exactly what Vercel runs), and the feature is verified end-to-end by generating a real brief and spot-checking the numbers. Do **not** add a test framework.

**Spec refinement note:** The spec said "the 5 system setups." The authoritative source is `SYSTEM_SETUPS` in `lib/trading-system.ts` (`A+ Confluence, ORB Break, TTM Squeeze, AVWAP Bounce, FVG Bounce, Divergence/Trendline Break, FireLines Level, No Setup`). We iterate all of these **except `No Setup`**; empty/thin buckets are trimmed by the N≥3 floor.

---

## File Structure

- **Create** `lib/edge-stats.ts` — `EdgeTrade` input type, `EdgeStat` output type, `computeEdgeStats()`, `formatEdgeStatsSection()`. Pure: no Supabase, no Anthropic.
- **Modify** `lib/pre-market-brief.ts` — import from `edge-stats`, add optional `edgeStats` param, append the edge section to the prompt, add one `SYSTEM_PROMPT` bullet.
- **Modify** `app/api/claude/pre-market/route.ts` — fetch trades, `computeEdgeStats`, pass as 3rd arg.
- **Modify** `app/api/brief/auto-import/route.ts` — fetch trades, `computeEdgeStats`, pass as 3rd arg.

---

## Task 1: Pure edge-stats module

**Files:**
- Create: `lib/edge-stats.ts`

- [ ] **Step 1: Create the module with types, compute, and format**

Create `lib/edge-stats.ts` with this exact content:

```ts
import { SYSTEM_SETUPS } from '@/lib/trading-system'
import type { Trade } from '@/types'

// Only the columns the brief callers fetch — keeps the input type honest.
export type EdgeTrade = Pick<
  Trade,
  'trade_bias' | 'trade_setup' | 'setup_tag' | 'net_pnl' | 'entry_time'
>

export interface EdgeStat {
  bias: 'Bull' | 'Bear' | 'Neutral'
  setup: string
  wins: number
  losses: number
  total: number // wins + losses; scratches (net_pnl === 0) excluded
  winRate: number // wins / total, 0–1
  avgNetPnl: number // mean net_pnl over the `total` trades
  firstDate: string // YYYY-MM-DD
  lastDate: string // YYYY-MM-DD
  thin: boolean // true when total is 3–4
}

const BIASES = ['Bull', 'Bear', 'Neutral'] as const

// Same matching semantics as FiveWordGateModal: case-insensitive substring
// over trade_setup + setup_tag.
function matchesSetup(t: EdgeTrade, setupName: string): boolean {
  if (!setupName) return false
  const haystack = [t.trade_setup, t.setup_tag].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(setupName.toLowerCase())
}

// entry_time is an ISO timestamp string; take the calendar date.
function toDate(iso: string): string {
  return iso.slice(0, 10)
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function monthRange(firstDate: string, lastDate: string): string {
  const fm = MONTHS[Number(firstDate.slice(5, 7)) - 1]
  const lm = MONTHS[Number(lastDate.slice(5, 7)) - 1]
  return fm === lm ? fm : `${fm}–${lm}`
}

/**
 * Bucket trades by (bias × setup). Drops buckets with ≤2 trades; tags buckets
 * with 3–4 trades as `thin`. Scratches (net_pnl === 0) are excluded entirely.
 */
export function computeEdgeStats(trades: EdgeTrade[]): EdgeStat[] {
  const stats: EdgeStat[] = []
  // 'No Setup' is the absence of a setup, not an edge to lean on — skip it.
  const setups = SYSTEM_SETUPS.filter((s) => s !== 'No Setup')

  for (const bias of BIASES) {
    for (const setup of setups) {
      const bucket = trades.filter(
        (t) =>
          (t.trade_bias ?? '').toLowerCase() === bias.toLowerCase() &&
          matchesSetup(t, setup) &&
          t.net_pnl !== 0,
      )
      const total = bucket.length
      if (total < 3) continue

      const wins = bucket.filter((t) => t.net_pnl > 0).length
      const sum = bucket.reduce((acc, t) => acc + t.net_pnl, 0)
      const dates = bucket.map((t) => toDate(t.entry_time)).sort()

      stats.push({
        bias,
        setup,
        wins,
        losses: total - wins,
        total,
        winRate: wins / total,
        avgNetPnl: sum / total,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        thin: total < 5,
      })
    }
  }
  return stats
}

/**
 * Render the stats into the prompt section. Full rows (N≥5) show win % + avg $;
 * thin rows (N=3–4) show record + count + range only. Returns '' when empty.
 */
export function formatEdgeStatsSection(stats: EdgeStat[]): string {
  if (stats.length === 0) return ''
  const lines = stats.map((s) => {
    const record = `${s.wins}–${s.losses}`
    const range = monthRange(s.firstDate, s.lastDate)
    if (s.thin) {
      return `- ${s.bias} · ${s.setup} [thin sample]: ${record} over ${s.total} trades (${range})`
    }
    const pct = Math.round(s.winRate * 100)
    const avg =
      s.avgNetPnl >= 0
        ? `+$${Math.round(s.avgNetPnl)}`
        : `-$${Math.abs(Math.round(s.avgNetPnl))}`
    return `- ${s.bias} · ${s.setup}: ${record} (${pct}%), ${avg} avg over ${s.total} trades (${range})`
  })
  return (
    '\n\nYour historical edge by setup and bias (all-time; use only the rows ' +
    "matching today's bias):\n" +
    lines.join('\n')
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build completes with no type or lint errors. (`SYSTEM_SETUPS` and `Trade` resolve; no unused vars.)

- [ ] **Step 3: Commit**

```bash
git add lib/edge-stats.ts
git commit -m "$(cat <<'EOF'
Edge stats: add pure bias x setup performance module

Buckets a trader's trades by (bias x setup) using the same matching
semantics as the entry-time gate, with an N>=3 floor and a 3-4 thin-sample
tag. Pure module so the brief and (later) the gate can share one source of
truth for personal edge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire edge stats into the brief generator

**Files:**
- Modify: `lib/pre-market-brief.ts`

- [ ] **Step 1: Add the import**

At the top of `lib/pre-market-brief.ts`, after the existing `econ-calendar` import (line 4), add:

```ts
import { formatEdgeStatsSection, type EdgeStat } from '@/lib/edge-stats'
```

- [ ] **Step 2: Add the SYSTEM_PROMPT bullet**

In `SYSTEM_PROMPT`, immediately after the earnings bullet (the line beginning `- If watchlist earnings are listed, fold them in:`) and before `- What NOT to do must reference...`, insert:

```
- If a personal edge table is provided, weave the rows matching today's bias into market_condition, day_type_expectation, and what_not_to_do. Treat a weak personal record on an approved setup as "demand A+ confluence / size down," never as a ban — the system's setup list still governs. Soften any row tagged [thin sample] to directional language; never quote a hard win rate off a thin sample.
```

- [ ] **Step 3: Add the optional `edgeStats` parameter**

Change the `generatePreMarketBrief` signature from:

```ts
export async function generatePreMarketBrief(
  context: string,
  clientHeadlines?: Headline[]
): Promise<PreMarketBrief | null> {
```

to:

```ts
export async function generatePreMarketBrief(
  context: string,
  clientHeadlines?: Headline[],
  edgeStats?: EdgeStat[]
): Promise<PreMarketBrief | null> {
```

- [ ] **Step 4: Build and append the edge section**

Just after the existing `const macroSection = formatMacroSection(today)` line, add:

```ts
  const edgeSection = formatEdgeStatsSection(edgeStats ?? [])
```

Then change the user-message `content` string from:

```ts
        content: `Today is ${today}. Here are my pre-market observations:\n\n${context}${newsSection}${macroSection}${earningsSection}\n\nGenerate my pre-market brief.`,
```

to:

```ts
        content: `Today is ${today}. Here are my pre-market observations:\n\n${context}${newsSection}${macroSection}${earningsSection}${edgeSection}\n\nGenerate my pre-market brief.`,
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: build completes clean. The new param is optional, so existing callers still type-check.

- [ ] **Step 6: Commit**

```bash
git add lib/pre-market-brief.ts
git commit -m "$(cat <<'EOF'
Brief: accept a personal edge table in the generator

Adds an optional edgeStats arg, appends the formatted (bias x setup) record
to the prompt, and instructs Claude to weave today's-bias rows into the plan
as confluence guidance — never overriding the system's setup list.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Feed edge stats from both brief callers

**Files:**
- Modify: `app/api/claude/pre-market/route.ts`
- Modify: `app/api/brief/auto-import/route.ts`

- [ ] **Step 1: Import compute in the manual route**

In `app/api/claude/pre-market/route.ts`, after the existing `generatePreMarketBrief` import (line 6), add:

```ts
import { computeEdgeStats } from '@/lib/edge-stats'
```

- [ ] **Step 2: Fetch trades and pass stats in the manual route**

Replace this line (currently line 23):

```ts
    const brief = await generatePreMarketBrief(context, clientHeadlines)
```

with:

```ts
    const { data: edgeTrades } = await supabase
      .from('trades')
      .select('trade_bias, trade_setup, setup_tag, net_pnl, entry_time')
      .eq('user_id', user.id)
    const edgeStats = computeEdgeStats(edgeTrades ?? [])

    const brief = await generatePreMarketBrief(context, clientHeadlines, edgeStats)
```

- [ ] **Step 3: Import compute in the auto-import route**

In `app/api/brief/auto-import/route.ts`, after the existing `generatePreMarketBrief` import (line 6), add:

```ts
import { computeEdgeStats } from '@/lib/edge-stats'
```

- [ ] **Step 4: Fetch trades and pass stats in the auto-import route**

In `app/api/brief/auto-import/route.ts`, replace this line (currently line 76):

```ts
      const aiBrief = await generatePreMarketBrief(brief)
```

with:

```ts
      const { data: edgeTrades } = await supabase
        .from('trades')
        .select('trade_bias, trade_setup, setup_tag, net_pnl, entry_time')
        .eq('user_id', userId)
      const edgeStats = computeEdgeStats(edgeTrades ?? [])
      const aiBrief = await generatePreMarketBrief(brief, undefined, edgeStats)
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: build completes clean. If TS flags the Supabase row shape as not assignable to `EdgeTrade[]`, append `as EdgeTrade[]` to the `edgeTrades ?? []` argument and add `EdgeTrade` to the `computeEdgeStats` import (`import { computeEdgeStats, type EdgeTrade } from '@/lib/edge-stats'`). Rebuild.

- [ ] **Step 6: Commit**

```bash
git add app/api/claude/pre-market/route.ts app/api/brief/auto-import/route.ts
git commit -m "$(cat <<'EOF'
Brief: source personal edge from trades on both entry points

The manual Generate Brief route and the morning auto-import now query the
user's trades and pass the computed (bias x setup) record into the brief.
Fetch is non-fatal — an empty/failed query yields no edge section and the
brief still generates.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Final gating build**

Run: `npm run build`
Expected: clean (lint + types + compile).

- [ ] **Step 2: Inspect the generated prompt section once**

Temporarily add, in `lib/pre-market-brief.ts` just after the `edgeSection` line:

```ts
  console.log('[edge-stats section]', edgeSection)
```

Run `npm run dev`, log in, open `/pre-market`, and click **Generate Brief** with any context. In the dev-server terminal confirm the `[edge-stats section]` log shows rows of the form `- Bull · ORB Break: 8–3 (73%), +$190 avg over 11 trades (Mar–Jun)`, with thin buckets tagged `[thin sample]` and showing no win %/avg. If you have no qualifying trades yet, the log will be empty (`''`) — that is the correct silent-when-uncertain behavior.

- [ ] **Step 3: Spot-check the numbers against the DB**

In the Supabase SQL editor, run (substitute your user id):

```sql
select trade_bias, trade_setup, setup_tag, net_pnl, entry_time
from trades
where user_id = '<your-user-id>'
order by entry_time;
```

Pick one `(bias, setup)` row from the logged section and confirm by hand that wins (`net_pnl > 0`), losses (`net_pnl < 0`), count, and date range match the query rows. Scratches (`net_pnl = 0`) should be excluded.

- [ ] **Step 4: Confirm the brief uses it**

Read the generated brief's `market_condition` / `what_not_to_do` fields and confirm Claude referenced your today's-bias edge (e.g. cautioning on a weak setup), and did **not** ban an approved setup outright.

- [ ] **Step 5: Remove the debug log**

Delete the `console.log('[edge-stats section]', ...)` line added in Step 2.

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit any cleanup**

Only if the debug-log removal left a diff:

```bash
git add lib/pre-market-brief.ts
git commit -m "$(cat <<'EOF'
Brief: drop edge-stats debug log after verification

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```
