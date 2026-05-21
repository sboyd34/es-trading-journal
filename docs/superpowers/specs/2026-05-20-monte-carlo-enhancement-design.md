# Monte Carlo Tab Enhancement — Design Spec
**Date:** 2026-05-20
**Status:** Approved

---

## Problem

The existing Monte Carlo tab (`reports/page.tsx`) shows upside distribution well but is blind to account survival. For an Apex prop trader, the trailing drawdown is the single most consequential risk metric — yet the current simulation never tracks it. The expected value stat is also computed but never displayed.

---

## Scope

Four additions only:

1. **Expected value stat card** — render the already-computed `expectedValue` value
2. **Ruin threshold input** — dollar input pre-filled from `riskRules.max_daily_loss`
3. **Ruin probability stat card** — % of paths that touch the threshold at any point during the path
4. **Max drawdown distribution histogram** — worst peak-to-trough per path across all 1,000 simulations, with a reference line at the ruin threshold

---

## Architecture

### New file: `components/reports/MonteCarloTab.tsx`

Self-contained component. All MC state, simulation math, and UI live here.

**Props:**
```ts
interface Props {
  trades: Trade[]
  riskRules: RiskRules | null
}
```

**Internal state:**
- `mcNumTrades: number` — trades per path, default 50, range 10–200
- `mcRunCount: number` — increments on each run to trigger recomputation
- `mcRuinThreshold: number` — pre-filled from `riskRules.max_daily_loss`, editable

**useMemo:** `monteCarloResult` — see Simulation Engine section below

### Modified file: `app/(app)/reports/page.tsx`

- Remove state vars: `mcNumTrades`, `mcRunCount`
- Remove the `monteCarloResult` useMemo (lines 473–521)
- Remove the MC tab JSX block (lines 1166–1308)
- Add import for `MonteCarloTab`
- Mount: `<MonteCarloTab trades={filteredTrades} riskRules={riskRules} />`

---

## Simulation Engine

The existing loop samples `net_pnl` with replacement and tracks cumulative P&L. Expand to also track:

```
for each path:
  peak = 0
  maxDD = 0
  ruined = false

  for each trade step t:
    cumulative += sample()
    peak = max(peak, cumulative)
    drawdown = peak - cumulative
    maxDD = max(maxDD, drawdown)
    if cumulative <= -ruinThreshold:
      ruined = true

  record maxDD[sim], ruined[sim]
```

**Additional return values:**
- `expectedValue` — mean of all final cumulative values (already computed, now returned and rendered)
- `ruinProb` — `(ruined paths / NUM_SIMS) * 100`
- `maxDDHistogram` — 25-bin histogram of `maxDD` values across all simulations

---

## UI

### Controls row
Existing: "Trades per path" input + Run/Re-Run button.
New: "Ruin threshold ($)" number input, pre-filled from `riskRules.max_daily_loss`, defaults to `1500` if no risk rules set.

### Stat cards — 6 total (up from 4)
| Card | Value | Color rule |
|---|---|---|
| Prob. of Profit | `X%` | green ≥ 50%, red < 50% |
| Median Outcome | `$X` | green ≥ 0, red < 0 |
| 5th Pct (Worst 5%) | `$X` | always red |
| 95th Pct (Best 5%) | `$X` | always green |
| Expected Value | `$X` | green ≥ 0, red < 0 |
| Ruin Probability | `X%` | red > 10%, amber 5–10%, green < 5% |

### Existing charts (unchanged)
- Equity path fan chart — 5th/25th/50th/75th/95th percentile lines
- Final P&L distribution histogram — 25 bins, green/red by sign

### New chart — Max Drawdown Distribution
- Bar chart, 25 bins
- X-axis: drawdown dollar amount
- Y-axis: simulation count
- Red vertical `ReferenceLine` at `mcRuinThreshold`
- Bars right of the line: red (exceeded threshold)
- Bars left of the line: gray/neutral
- Caption: "Peak-to-trough drawdown across 1,000 paths. Red line = your ruin threshold."

---

## Data Flow

```
reports/page.tsx
  filteredTrades, riskRules
    └─> <MonteCarloTab trades={filteredTrades} riskRules={riskRules} />
          mcNumTrades, mcRunCount, mcRuinThreshold (internal state)
            └─> monteCarloResult useMemo
                  fanData, histogram, maxDDHistogram,
                  probProfit, median, p5, p95, expectedValue, ruinProb
```

---

## Constraints

- No new API routes — all computation is client-side
- `reports/page.tsx` passes `filteredTrades` (respects the existing date range filter), not the raw full `trades` array
- The ruin threshold input is local state only — it does not write back to `risk_rules`
- Type-check gate: `npx tsc --noEmit` must pass before shipping
