// Builds the R-multiple sample set the Apex eval Monte Carlo resamples from.
//
// Pure module — no Supabase, no Next, no I/O — so the round-trip invariant is
// verifiable by assertion (see scripts/test-eval-samples.mts).
//
// WHY THIS IS A DOLLAR REPLAY AND NOT A RISK NORMALIZATION
//
// The previous implementation divided each trade's net P&L by that trade's OWN
// stop distance when a stop existed, and by the single `riskPerTrade` input
// when it did not — then re-scaled every resulting R by `riskPerTrade` inside
// simulate(). That is only coherent if the denominator is uniform. It was not:
//
//   - 12 of 48 trades had a stop, so they were scaled by riskPerTrade/stopRisk
//   - the other 36 round-tripped exactly (net_pnl / X * X === net_pnl)
//
// The well-documented trades were the corrupted ones. Tight-stop MES rows were
// inflated up to 50x (a $1 trade entered the simulation as $73); the widest
// stop deflated by 0.32x. Aggregate expectancy came out at $49.25/trade against
// an actual $14.88 — a 231% inflation that produced a 97.5% pass probability.
//
// Normalizing properly would require a real stop on all 48 trades, which this
// account does not have and cannot retroactively acquire. So the model is
// instead a literal replay of realized dollars: r = net_pnl / riskPerTrade for
// EVERY trade, uniformly. `riskPerTrade` becomes a pure position-size
// multiplier — answering "if I keep trading as I have, what are my odds?"
// rather than the counterfactual "if I had sized every trade to risk $X".
//
// Do not reintroduce per-trade stop denominators here without also making the
// coverage 100%. Mixed denominators are worse than either consistent extreme.

// DELIBERATE duplicate of lib/instruments.ts. Everywhere else in the app
// imports that shared table — this file is the one exception, and it has to be.
//
// scripts/test-eval-samples.mts runs this module directly under bare node, with
// no bundler. That rules out both ways of sharing: `@/lib/instruments` because
// node cannot resolve the tsconfig path alias, and `./instruments.ts` because
// tsconfig has allowImportingTsExtensions off, so the explicit extension node
// requires is the one thing tsc rejects. Extensionless `./instruments` fails
// with ERR_MODULE_NOT_FOUND — verified, not assumed.
//
// Keeping this module dependency-free is what makes it testable outside Next,
// which is worth more than deduplicating four numbers. If you change a point
// value in lib/instruments.ts, change it here too.
export const POINT_VALUES: Record<string, number> = { ES: 50, MES: 5, NQ: 20, MNQ: 2 }

export interface RSample {
  /** Net P&L expressed in units of riskPerTrade. */
  r: number
  /**
   * Peak unrealized gain in units of riskPerTrade, or null when MFE is
   * unrecorded. Drives the Apex trailing-threshold ratchet, which trails on
   * unrealized highs — a trade that ran +3R before closing +0.5R still moved
   * the threshold up.
   */
  mfeR: number | null
}

export interface SampleTrade {
  net_pnl: number
  quantity: number | null
  instrument: string | null
  /** Maximum favorable excursion in POINTS (always positive). */
  mfe: number | null
}

// PLAN-SIZED SAMPLES — "if I trade the plan's size, what are my odds?"
//
// The dollar replay above inherits whatever size was traded: three 4-contract
// ES winners can carry a whole sample. The trading plan instead risks a FIXED
// amount behind an 8-tick (2-point) stop — 1 ES or 12 MES on the 50K, 7 MES on
// the 25K. So this expresses every trade in points captured PER CONTRACT and
// measures it against that same 2-point stop:
//
//   r    = net_pnl / (quantity × point value) / 2
//   mfeR = mfe (points, per contract) / 2
//
// One uniform denominator for every trade (contract size, then the fixed
// stop) — not per-trade stops, which the header above rules out. simulate()
// then multiplies by riskPerTrade, the dollar value of that 2-point stop at
// plan size, so riskPerTrade means exactly what it means in the plan.
export const PLAN_STOP_POINTS = 2 // the plan bracket's 8-tick stop
// The plan's /ES target in R: 12 ticks / 8-tick stop = 1.5R, no runners.
// MIRRORS ES_BRACKET in lib/apex-config.ts — this module stays dependency-free
// so its test runs under bare node; change both together.
export const PLAN_TARGET_R = 1.5

// `bracket`: assume the plan's bracket held — every trade clipped to
// [-1R, +PLAN_TARGET_R], and open profit capped at that target. Off by default,
// because the history shows stops wider than 8 ticks; on, it answers "what
// if I honor the stop?" (optimistic: a winner whose MAE would have touched
// the stop is still counted as a winner when its MAE is unrecorded).
export function buildPlanSizedSamples(
  trades: SampleTrade[],
  opts: { bracket?: boolean } = {},
): RSample[] {
  return trades.map(t => {
    const pv = POINT_VALUES[t.instrument ?? 'ES'] ?? 50
    const contracts = t.quantity && t.quantity > 0 ? t.quantity : 1
    const r = t.net_pnl / (contracts * pv) / PLAN_STOP_POINTS
    const mfeR = t.mfe != null ? t.mfe / PLAN_STOP_POINTS : null
    return opts.bracket
      ? { r: Math.min(Math.max(r, -1), PLAN_TARGET_R), mfeR: mfeR === null ? null : Math.min(mfeR, PLAN_TARGET_R) }
      : { r, mfeR }
  })
}

export function buildRSamples(trades: SampleTrade[], riskPerTrade: number): RSample[] {
  // riskPerTrade is the sole denominator. A non-positive or NaN value would
  // yield Infinity/NaN R values that simulate() would consume without
  // complaint, so fail loudly here instead.
  if (!(riskPerTrade > 0)) {
    throw new Error(`riskPerTrade must be a positive number, got ${riskPerTrade}`)
  }

  return trades.map(t => {
    const pv = POINT_VALUES[t.instrument ?? 'ES'] ?? 50
    const mfeDollars = t.mfe != null ? t.mfe * pv * (t.quantity ?? 1) : null

    return {
      r: t.net_pnl / riskPerTrade,
      mfeR: mfeDollars != null ? mfeDollars / riskPerTrade : null,
    }
  })
}
