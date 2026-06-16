# Personal Edge Stats in Pre-Market Brief — Design Spec
**Date:** 2026-06-15
**Status:** Approved

---

## Problem

The pre-market brief is rich on *external* inputs — Polygon news, the macro-event
calendar, watchlist earnings — plus the trader's freeform observations. It is
completely blind to the trader's *own track record*. The brief tells the trader
what the **system** says, never what actually **works for them**.

The journal already proves this gap is worth closing: `FiveWordGateModal` computes
a per-`(setup, bias)` historical win rate at trade-entry time. Nothing surfaces
that edge *before* the session, when the plan is being formed.

---

## Goal

Fold the trader's all-time `(bias × setup)` performance into the brief so Claude
can weave it into the plan — e.g. "On Bull-bias days your ORB Break is 8–3, +$190
avg; your AVWAP Bounce is 2–5 — demand A+ confluence." The stats **inform setup
selection; they never override system rules.**

---

## Locked Decisions

| Decision | Choice | Why |
|---|---|---|
| Lookback | **All-time** | Sample size is the binding constraint while history is shallow; recency filtering starves thin `bias×setup` buckets. |
| Regime transparency | Show **trade count + date range** per cell | Lets the trader judge staleness ("all from one March run") instead of the system asserting a stable edge — serves the documented "don't overfit one bull regime" instinct. |
| Sample-size tiers | N≥5 = shown · N=3–4 = "thin sample" · N≤2 = suppressed | Keeps thin-but-real data visible *with caveat*; kills pure-anecdote noise. |
| Metrics | **W–L record, win %, avg net $/trade** | Avg $/trade catches a real edge that win % alone hides (low win rate + big winners). Skips profit factor / expectancy (need bigger N). |
| Bias resolution | Hand Claude the **full table** (all biases × setups); it picks rows for the bias it determines | Bias is an *output* of the brief, so it can't pre-filter. One LLM call, no two-pass parsing. |

---

## Architecture

### New file: `lib/edge-stats.ts`

Pure module — no Supabase, no Anthropic. Independently verifiable.

```ts
export interface EdgeStat {
  bias: 'Bull' | 'Bear' | 'Neutral'
  setup: string
  wins: number
  losses: number          // net_pnl < 0; scratches (net_pnl === 0) excluded
  total: number           // wins + losses (scratches not counted)
  winRate: number         // wins / total, 0–1
  avgNetPnl: number       // mean net_pnl over the `total` trades (scratches excluded)
  firstDate: string       // YYYY-MM-DD, earliest entry_time in bucket
  lastDate: string        // YYYY-MM-DD, latest entry_time in bucket
  thin: boolean           // true when total is 3–4
}

// Buckets trades by (bias × setup); drops buckets with total ≤ 2.
export function computeEdgeStats(trades: Trade[]): EdgeStat[]

// Renders the EdgeStat[] into the prompt section string (or '' when empty).
export function formatEdgeStatsSection(stats: EdgeStat[]): string
```

**Bucketing semantics** (mirrors `FiveWordGateModal` for consistency):
- Setup match: reuse the gate's `matchesSetup` semantics — case-insensitive
  substring over `[trade_setup, setup_tag]`. The 5-setup `<select>` in the gate
  keeps `trade_setup` constrained, so buckets won't fragment.
- Bias match: `(t.trade_bias ?? '').toLowerCase() === bias.toLowerCase()`.
- Win = `net_pnl > 0`; loss = `net_pnl < 0`; scratch = `0` (excluded from W–L).
- A trade is bucketable only when it has a non-null `trade_bias` **and** a
  resolvable setup; otherwise it is skipped.
- Iterate over the 5 system setups × {Bull, Bear, Neutral}; emit only buckets
  with `total ≥ 3`. Tag `thin = true` when `total` is 3–4.

**`formatEdgeStatsSection` output** (example):
```
Your historical edge by setup and bias (all-time; use only the rows matching
today's bias):
- Bull · ORB Break: 8–3 (73%), +$190 avg over 11 trades (Mar–Jun)
- Bull · AVWAP Bounce: 2–5 (29%), -$60 avg over 7 trades (Apr–Jun)
- Bear · ORB Break [thin sample]: 2–1 over 3 trades (May–Jun)
```
Formatting rules:
- **Full rows (N≥5):** record + win % + avg net $ + count + date range.
- **Thin rows (N=3–4):** record + count + date range only — **no win %, no avg
  $** (those numbers are too noisy at this N to display), plus the
  `[thin sample]` tag.

Returns `''` when no bucket qualifies.

### Modified file: `lib/pre-market-brief.ts`

- New optional third parameter on the shared generator:
  ```ts
  export async function generatePreMarketBrief(
    context: string,
    clientHeadlines?: Headline[],
    edgeStats?: EdgeStat[],
  ): Promise<PreMarketBrief | null>
  ```
- Build `edgeSection = formatEdgeStatsSection(edgeStats ?? [])` and append it to
  the user message alongside `newsSection`/`macroSection`/`earningsSection`.
- Add one `SYSTEM_PROMPT` bullet:
  > If a personal edge table is provided, weave the rows matching today's bias
  > into `market_condition`, `day_type_expectation`, and `what_not_to_do`. Treat
  > a weak personal record on an *approved* setup as "demand A+ confluence /
  > size down," never as a ban — the system's setup list still governs. Soften
  > any row tagged `[thin sample]` to directional language; never quote a hard
  > win rate off a thin sample.

### Modified callers

Both already hold a Supabase client + `userId`:

- `app/api/claude/pre-market/route.ts` (manual "Generate Brief"): cookie auth,
  `user.id`.
- `app/api/brief/auto-import/route.ts` (morning auto-import): service client,
  `userId` from `profiles`.

Each caller, before calling the generator:
1. Fetches the user's trades (`user_id` scoped) — columns
   `trade_bias, trade_setup, setup_tag, net_pnl, entry_time`.
2. `const edgeStats = computeEdgeStats(trades)`.
3. Passes `edgeStats` as the third arg.

---

## Error Handling

Fully non-fatal and silent-when-uncertain, matching the news/earnings sections:
- Trades query fails or returns nothing qualifying → `edgeStats = []` →
  `formatEdgeStatsSection` returns `''` → brief generates normally with no edge
  section. A stats failure must never block brief generation.

---

## Non-Goals (explicit YAGNI)

- **No gate refactor.** `FiveWordGateModal` keeps its own inline logic; we mirror
  its semantics rather than touching working code. Deduping the shared matcher
  into `lib/edge-stats.ts` is a flagged *future* opportunity, out of scope here.
- **No time-window dimension.** Bias × setup only (idea #3, separate feature).
- **No trailing/recency window.** All-time only until per-bucket counts are
  healthy enough to slice.
- **No new DB columns, no new API routes, no new npm dependencies.**

---

## Verification

Manual (no test suite in this project):
1. `npm run build` passes (lint + types + compile — the gating check).
2. Generate a brief; confirm the edge rows render and that Claude weaves the
   today's-bias rows into the plan.
3. Spot-check the rendered numbers against a hand-run Supabase query over the
   `trades` table.
