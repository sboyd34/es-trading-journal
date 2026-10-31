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
