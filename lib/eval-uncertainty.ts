// Uncertainty quantification for the Apex eval Monte Carlo.
//
// Pure module — no Supabase, no Next, no I/O — so it can be verified by
// assertion (see scripts/test-eval-uncertainty.mts).
//
// UNITS: every function here takes and returns PROPORTIONS (0–1) for inputs
// and PERCENTAGE POINTS (0–100) for the exported error/CI fields. The ×100
// conversion happens exactly once, inside computeUncertainty.

export const BOOTSTRAP_REPS = 300
export const BOOTSTRAP_INNER_SIMS = 300

/** CI width (percentage points) at or below which the point estimate is shown. */
export const CI_ADEQUATE_MAX_WIDTH = 10
/** CI width above which no percentage is rendered at all. */
export const CI_DIRECTIONAL_MAX_WIDTH = 20
/**
 * Below this fraction of trades carrying a recorded MFE, the Apex
 * trailing-threshold ratchet goes unmodeled on too much of the sample for the
 * fail probability to be trusted as a floor.
 */
export const MIN_EXCURSION_COVERAGE = 0.5
/** Fewer distinct trading days than this means the sample is one regime. */
export const MIN_DISTINCT_DAYS = 20

export type AdequacyVerdict = 'adequate' | 'directional' | 'insufficient'

/**
 * Linear-interpolating quantile on (n-1)*p.
 *
 * Deliberately NOT the route's existing `pct()` helper, which indexes with
 * Math.floor(len * p) and is biased outward at the tails. That bias is
 * negligible for the p50 fan lines and material for a 95% interval, where it
 * systematically widens the reported CI.
 */
export function quantile(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return sorted[0]
  const clamped = Math.min(1, Math.max(0, p))
  const h = (n - 1) * clamped
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, n - 1)
  const frac = h - lo
  return sorted[lo] + frac * (sorted[hi] - sorted[lo])
}

export interface UncertaintyInput {
  /** Pass proportions (0–1), one per outer bootstrap replicate. */
  bootstrapProps: number[]
  /** Inner simulations run per replicate (M). */
  innerSims: number
  /** Point estimate as a proportion (0–1), from the full run on the real sample. */
  pointEstimate: number
  /** Simulation count behind the point estimate. */
  numSimulations: number
}

export interface UncertaintyResult {
  /** 95% percentile interval, percentage points. */
  passProbCI: [number, number]
  /** Error attributable to simulation count, percentage points. */
  mcStdErr: number
  /** Error attributable to sample size, percentage points. */
  estimationStdErr: number
  /** passProbCI[1] - passProbCI[0], percentage points. */
  ciWidth: number
}

export function computeUncertainty(i: UncertaintyInput): UncertaintyResult {
  const { bootstrapProps, innerSims, pointEstimate, numSimulations } = i

  const mcVar = numSimulations > 0
    ? (pointEstimate * (1 - pointEstimate)) / numSimulations
    : 0
  const mcStdErr = Math.sqrt(mcVar) * 100

  const b = bootstrapProps.length
  if (b === 0) {
    return { passProbCI: [0, 0], mcStdErr, estimationStdErr: 0, ciWidth: 0 }
  }

  const sorted = [...bootstrapProps].sort((x, y) => x - y)
  const lo = quantile(sorted, 0.025) * 100
  const hi = quantile(sorted, 0.975) * 100

  // Total observed spread across replicates = estimation variance + inner
  // binomial noise. Subtract the known noise term to isolate the part driven
  // by sample size, which is the part more simulations cannot fix.
  const mean = bootstrapProps.reduce((s, v) => s + v, 0) / b
  const totalVar = b > 1
    ? bootstrapProps.reduce((s, v) => s + (v - mean) ** 2, 0) / (b - 1)
    : 0
  const innerNoise = innerSims > 0
    ? bootstrapProps.reduce((s, v) => s + (v * (1 - v)) / innerSims, 0) / b
    : 0
  const estimationVar = Math.max(0, totalVar - innerNoise)

  return {
    passProbCI: [lo, hi],
    mcStdErr,
    estimationStdErr: Math.sqrt(estimationVar) * 100,
    ciWidth: hi - lo,
  }
}

export interface AdequacyInput {
  ciWidth: number
  tradeCount: number
  distinctDays: number
  /** Trades carrying a recorded MFE, which is what gates the trailing ratchet. */
  excursionsPresent: number
  bootstrapReps: number
}

export interface Adequacy {
  verdict: AdequacyVerdict
  ciWidth: number
  tradeCount: number
  distinctDays: number
  excursionCoverage: number
  suppressRiskComparison: boolean
  blockers: string[]
}

export function assessAdequacy(i: AdequacyInput): Adequacy {
  const { ciWidth, tradeCount, distinctDays, excursionsPresent, bootstrapReps } = i
  const excursionCoverage = tradeCount > 0 ? excursionsPresent / tradeCount : 0
  const blockers: string[] = []

  let verdict: AdequacyVerdict =
    ciWidth <= CI_ADEQUATE_MAX_WIDTH
      ? 'adequate'
      : ciWidth <= CI_DIRECTIONAL_MAX_WIDTH
      ? 'directional'
      : 'insufficient'

  // A collapsed or incomplete bootstrap is a failure to measure uncertainty,
  // not evidence of precision. Never let either read as confidence.
  if (bootstrapReps === 0) {
    verdict = 'insufficient'
    blockers.push('Confidence interval could not be computed — the bootstrap did not run.')
  } else if (bootstrapReps < BOOTSTRAP_REPS) {
    verdict = 'insufficient'
    blockers.push(
      `Only ${bootstrapReps} of ${BOOTSTRAP_REPS} bootstrap replicates completed — interval is unreliable.`,
    )
  } else if (ciWidth === 0) {
    verdict = 'insufficient'
    blockers.push('Confidence interval collapsed to zero width — the bootstrap produced no spread.')
  }

  // A narrow CI over too few trading days measures resampling within one market
  // regime, not accuracy across regimes. Cap at 'directional' so the headline
  // never asserts precision the sample cannot support. This is a downgrade only —
  // it must not upgrade an 'insufficient' verdict the bootstrap-integrity branches
  // above already assigned.
  if (distinctDays < MIN_DISTINCT_DAYS && verdict === 'adequate') {
    verdict = 'directional'
  }

  if (excursionCoverage < MIN_EXCURSION_COVERAGE) {
    blockers.push(
      `Only ${excursionsPresent} of ${tradeCount} trades have a recorded MFE (${Math.round(excursionCoverage * 100)}%). ` +
        `Apex trails the drawdown threshold on unrealized highs, so trades with no excursion data ` +
        `never ratchet it — these odds understate fail risk.`,
    )
  }

  if (distinctDays < MIN_DISTINCT_DAYS) {
    blockers.push(
      `Sample spans ${distinctDays} trading day${distinctDays === 1 ? '' : 's'} — effectively one market regime. ` +
        `These odds assume future days resemble them.`,
    )
  }

  return {
    verdict,
    ciWidth,
    tradeCount,
    distinctDays,
    excursionCoverage,
    // Risk-per-trade is a uniform position-size multiplier on a dollar replay,
    // so the comparison is arithmetically meaningful at any excursion coverage.
    // It is withheld only when the pass probability itself is not estimable.
    suppressRiskComparison: verdict === 'insufficient',
    blockers,
  }
}
