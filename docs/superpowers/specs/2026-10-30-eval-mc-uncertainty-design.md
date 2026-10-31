# Eval Monte Carlo — Honest Uncertainty — Design Spec
**Date:** 2026-10-30
**Status:** Approved

---

## Problem

`/api/backtest/eval-monte-carlo` reports `passProb` to one decimal place off
10,000 simulations. That precision is fake.

`passProb = passCount / numSimulations` is an unbiased estimate of pass
probability **conditional on the live R distribution being the true
distribution.** That conditioning does enormous unacknowledged work. The live
distribution is currently:

| Fact | Value |
|---|---|
| Live trades | 47 |
| Distinct trading days | 8 (2026-10-21 → 2026-10-29) |
| Trades with usable `stop_loss` | **11 of 47** |
| Trades with `mfe` **and** a stop (MFE ratchet eligible) | **≤ 11** |
| `backtest_trades` rows | **0** |

So the headline `73.4%` carries roughly ±0.5pt of simulation error and something
closer to ±15–20pt of estimation error — and the UI shows only the error term
that doesn't matter. Raising `numSimulations` to 20,000 shrinks the visible term
while leaving the invisible one exactly as large.

Three concrete dishonesty surfaces follow from this:

1. **`EvalPassOddsCard`** renders a bare `73.4%` on the dashboard every morning
   with no caveat at all. It is the most-seen and least-qualified surface in the
   feature.
2. **The Risk Per Trade Comparison table** is tautological. 36 of 47 trades fall
   back to `riskDollars = input.riskPerTrade`, so `r = net_pnl / 500`; the sim
   then computes `equity += r * riskPerTrade`. Asking "what if I risked $1,000?"
   returns "your P&L doubles" **by construction**, not by evidence.
3. **The `combined` source toggle** reads `backtest_trades`, which has zero rows.
   Selecting it changes nothing yet renders a caveat implying it did.

A measurement worth recording, because it killed an earlier hypothesis: the
trade stream was tested for serial dependence before this design was chosen.
Autocorrelation sat inside the white-noise band at every lag 1–5, the
Wald-Wolfowitz runs test returned **z = 0.121**, and intraclass correlation was
negligible. Day-block resampling produced max drawdowns 38–45% *lower* than IID
— an artifact of drawing 120 days from only 8 distinct day-patterns, which
under-samples the sequence space and makes paths self-similar. **IID
trade-level resampling is therefore correct for this dataset**, and block
resampling is deferred until there are enough distinct days to resample from.

---

## Goal

Make the simulator honest about its own uncertainty. Not more accurate — more
truthful about not being accurate.

Expected outcome: pass odds stop reading `73.4%` and start reading something
like `45–88% — insufficient data`. That feels worse and is correct. The fix
that actually narrows the interval is capturing real stops (deferred, next in
queue), not anything in this spec.

---

## Locked Decisions

| Decision | Choice | Why |
|---|---|---|
| Uncertainty method | **Nested (double) bootstrap** | Resampling the trade set and re-simulating is the only way to propagate sample-size uncertainty into the pass-probability estimate. Analytic CIs don't exist for a path-dependent trailing-drawdown simulator. |
| Bootstrap unit | **Individual trade**, not day | Measured: ACF inside the white-noise band at all lags, runs test z = 0.121. Day-blocks would also be unusable at 8 distinct days. Unit changes to the day if/when block resampling lands. |
| Budget split | `B = 300` outer × `M = 300` inner | Outer variance is the quantity being measured; inner binomial noise is subtracted analytically. Spend on **B**, not **M**. |
| Point estimate | **Unchanged** — full `numSimulations` on the real sample | The CI describes uncertainty *around* the existing estimate. Don't move the number and widen the interval in the same change. |
| Gate trigger | **CI width**, not a trade-count threshold | Self-calibrating: the interval narrows as the sample grows, so the gate opens by itself. No magic constants to maintain. |
| `insufficient` cut | CI width **> 20pt** | A ±10pt interval still supports a decision ("more likely than not to pass"). A 73% that could honestly be 45% or 88% supports nothing, so rendering `73.4%` is actively worse than rendering nothing. Judgment call, single constant, easy to move. |
| Dead `combined` toggle | **Delete**, don't gate | Dead UI that lies is worse than absent UI. Re-add when `backtest_trades` has rows. |
| Response shape | **Additive only** | No existing field changes type or meaning; nothing downstream breaks. |

---

## Architecture

### Modified: `app/api/backtest/eval-monte-carlo/route.ts`

#### Nested bootstrap

```
for b in 1..B:
  samples_b = resample `samples` WITH replacement, to size samples.length
  p̂_b      = simulate(samples_b, input, input.riskPerTrade, false).passCount / M
```

`collectFan: false` throughout the inner runs — the existing flag already gates
the per-checkpoint array allocation, which is where most of the cost sits.

Resampling with replacement means some resamples draw **zero** of the 11
real-stop trades, or zero MFE-eligible ones. That is the mechanism, not a bug:
the fragility of an 11-trade subset propagates into the interval instead of
hiding behind the point estimate.

#### Variance decomposition

**Units — compute in proportions, convert once at the boundary.** `p̂_b` and all
variance algebra are in proportion space (0–1). Every exported field is in
**percentage points** (0–100), multiplied by 100 exactly once, immediately
before being placed on the response. Mixing the two scales is the likeliest bug
in this change: a variance term converted with `× 100` instead of `× 100²`, or
a `stdErr` rendered as `0.004` next to a `73.4`.

```
// proportion space
Var(p̂_b)          = sample variance of the B outer estimates
innerNoise        = mean( p̂_b * (1 − p̂_b) / M )     // known binomial term
estimationVar     = max(0, Var(p̂_b) − innerNoise)
mcVar             = p * (1 − p) / numSimulations     // p = point estimate, proportion

// → response, percentage points
estimationStdErr  = sqrt(estimationVar) * 100
mcStdErr          = sqrt(mcVar) * 100
passProbCI        = [quantile(p̂, 0.025) * 100, quantile(p̂, 0.975) * 100]
adequacy.ciWidth  = passProbCI[1] − passProbCI[0]
```

Two separately reportable numbers: "±0.4pt because only 10,000 sims ran" versus
"±17pt because there are only 47 trades." The first is fixable with compute.
The second is not fixable at all except by trading more.

**The `±` the UI renders is `estimationStdErr`, not the CI half-width.** The CI
is a percentile interval and may be asymmetric around the point estimate, so
collapsing it to a single `±` would misrepresent it. The `adequate` branch shows
`passProb ± estimationStdErr`; the `directional` branch shows the raw interval
endpoints.

**Do not reuse the existing `pct()` helper for the CI.** It indexes with
`Math.floor(sorted.length * p)`, which is biased outward at the tails — at
`p = 0.025` over `B = 300` it returns index 7 where the interpolated quantile
sits at `(300 − 1) × 0.025 = 7.475`. That bias is negligible for the existing
`p50` fan lines and material for a 95% interval, where it systematically widens
the reported CI. Add a separate interpolating quantile for the bootstrap
distribution and leave `pct()` untouched so the fan chart output does not
shift in this change.

#### Compute budget

Current: `5 × numSimulations` paths (1 main with fan + 4 comparison risks) =
50,000 paths at 10,000 sims, each ≤ `maxTrades` but usually exiting early on
pass/fail. Adding `300 × 300 = 90,000` fan-less paths is ≈1.8× current total
work. Vercel's default function timeout is 300s and this route currently
returns in well under a second, so there is ample headroom — but wall-clock it
during implementation rather than assuming.

#### New response fields

```ts
passProbCI: [number, number]       // 95% percentile interval, percentage points
mcStdErr: number                   // simulation-count error
estimationStdErr: number           // sample-size error
bootstrapReps: number              // B actually run
adequacy: {
  verdict: 'adequate' | 'directional' | 'insufficient'
  ciWidth: number                  // percentage points
  tradeCount: number
  distinctDays: number
  stopCoverage: number             // 0..1
  blockers: string[]               // human-readable, rendered as-is
}
```

`distinctDays` requires adding `date` to the existing `trades` select.

#### Gate logic

| CI width | Verdict |
|---|---|
| ≤ 10pt | `adequate` |
| 10–20pt | `directional` |
| > 20pt | `insufficient` |

Two structural flags evaluate independently of CI width and append to
`blockers`:

- **`stopCoverage < 0.5`** → suppress the risk comparison entirely (see below).
- **`distinctDays < 20`** → blocker noting the sample spans N days of a single
  regime, regardless of how many trades sit inside them.

#### Removals

- The `combined` branch, the `backtest_trades` query, `combinedCaveat`, and
  `source` from `EvalSimInput` / `EvalMonteCarloResponse`.
- Hardcoded `currentEquity: 251_636.10` and `currentThreshold: 245_136.10`
  (lines 212–213) — a snapshot of one account on one day baked into source.
  Read from `apex_accounts` when available; fall back to `startingEquity` and
  `startingEquity − trailingDrawdown`.

### Modified: `app/(app)/backtest/eval/page.tsx`

- **Headline block** (lines 209–233) becomes gate-aware, three branches on
  `adequacy.verdict`:
  - `adequate` → `73.4%` with `±4.1` beneath it
  - `directional` → `58–81%` as the headline; point estimate demoted to small text
  - `insufficient` → no percentage; a "what's missing" panel listing `blockers`
- **Stability caveat** (lines 200–206) — replace the qualitative
  "Small samples (<30) make results unstable" with the quantified
  decomposition. Same warning, with a number attached.
- **`passProbColor()`** gains a fourth state (gray) for `insufficient`.
- **Risk comparison table** (lines 288–339) wrapped in the `stopCoverage` flag;
  when suppressed, render one line explaining the identity-function problem.
- **Source `<select>`** (lines 162–171) removed with the `combined` branch.
- Remove the duplicated hardcoded equity defaults from `useState`.

### Modified: `components/dashboard/EvalPassOddsCard.tsx`

The `LS_KEY = 'apex.eval.lastResult'` payload gains `passProbCI` and `verdict`.
When `verdict === 'insufficient'` the card shows the interval plus a
"needs more data" chip instead of a number. Malformed or pre-upgrade
localStorage entries already fall through the existing `try/catch` to
`lastRun = null`, which renders nothing — consistent with the
silent-when-clean convention, and it means stale payloads from before this
change simply stop rendering until the next run.

---

## Error Handling

- The existing `samples.length < 5` guard stays and short-circuits before any
  bootstrap work.
- If every outer resample degenerates (e.g. all-identical draws producing zero
  variance), `estimationStdErr` clamps to 0 via `max(0, …)` and the CI collapses
  to a point. That reads as `adequate`, which would be wrong — so treat
  `bootstrapReps < B` or a zero-width CI as a hard `insufficient` rather than
  trusting it.
- Bootstrap failure must not fail the request. On any throw inside the nested
  loop, return the existing fields with `adequacy.verdict = 'insufficient'` and
  a blocker explaining the CI could not be computed. A broken error bar is not
  a reason to withhold the simulation.

---

## Non-Goals (explicit YAGNI)

- **No accuracy improvement.** This widens the reported interval; it does not
  move the point estimate or make the model better.
- **No day-block / stationary bootstrap.** Measured as unsupported at 8 distinct
  days. Revisit at ~50 trading days.
- **No `stop_loss` capture fix.** That is the change that actually narrows the
  interval, and it is the next piece of work — but it is a separate concern and
  a separate commit.
- **No changes to `components/reports/MonteCarloTab.tsx`.** The Reports MC has
  its own distinct problems (bootstraps raw `net_pnl`, misuses a daily loss
  limit as a cumulative ruin threshold, computes `maxDD` and never uses it).
  Out of scope.
- **No freeze-rule verification.** The `freezeThreshold = startingEquity + 100`
  comment at route.ts:86–89 still warrants checking against the current Apex
  agreement. Unchanged here.
- **No new DB columns, no new migrations, no new npm dependencies.**

---

## Verification

Manual (no test suite in this project):

1. `npm run build` passes — lint + types + compile, the gating check.
2. Run the simulation on live data (47 trades, 11 stops). Expect
   `verdict: 'insufficient'`, no headline percentage, the risk comparison table
   suppressed, and blockers naming stop coverage and distinct-day count.
3. Confirm `mcStdErr` is sub-1pt while `estimationStdErr` is an order of
   magnitude larger — that gap is the whole point of the change.
4. Re-run at `numSimulations` 1,000 vs 20,000. `mcStdErr` should shrink visibly;
   `passProbCI` width should barely move. If the CI narrows materially with more
   sims, the decomposition is wrong.
5. Load `/dashboard` and confirm `EvalPassOddsCard` no longer shows a bare
   percentage.
6. Wall-clock the route and record the actual timing against the ≈1.8× estimate.
