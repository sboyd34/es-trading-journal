import {
  quantile,
  computeUncertainty,
  assessAdequacy,
  BOOTSTRAP_REPS,
} from '../lib/eval-uncertainty.ts'

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`PASS  ${label}`)
  } else {
    failures++
    console.log(`FAIL  ${label}\n  expected ${e}\n  actual   ${a}`)
  }
}
const round = (v: number, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp

// ---------- quantile: interpolating, not floor-indexed ----------
check('q median odd',    quantile([1, 2, 3, 4, 5], 0.5), 3)
check('q median even',   quantile([1, 2, 3, 4], 0.5), 2.5)
check('q interpolates',  quantile([0, 100], 0.025), 2.5)
check('q single',        quantile([42], 0.9), 42)
check('q empty',         quantile([], 0.5), 0)
check('q clamps low p',  quantile([1, 2, 3], 0), 1)
check('q clamps high p', quantile([1, 2, 3], 1), 3)

// The bias this replaces: over 300 values 0..299 the floor estimator returns
// index 7 exactly; the interpolated quantile sits at (300-1)*0.025 = 7.475.
// Reporting 7 instead of 7.475 systematically widens the CI at both tails.
const b300 = Array.from({ length: 300 }, (_, i) => i)
check('q no floor bias', round(quantile(b300, 0.025)), 7.475)
check('floor would give', Math.floor(300 * 0.025), 7)

// ---------- computeUncertainty ----------
// props [0.2, 0.8], M = 100, point = 0.5, sims = 10_000
//   mean            = 0.5
//   sampleVar (n-1) = ((0.2-0.5)^2 + (0.8-0.5)^2) / 1 = 0.18
//   innerNoise      = mean(0.2*0.8/100, 0.8*0.2/100)  = 0.0016
//   estimationVar   = 0.18 - 0.0016 = 0.1784
//   estimationStdErr= sqrt(0.1784) * 100 = 42.2374
//   mcStdErr        = sqrt(0.5*0.5/10000) * 100 = 0.5
//   CI lo           = (0.2 + 0.025*0.6) * 100 = 21.5
//   CI hi           = (0.2 + 0.975*0.6) * 100 = 78.5
{
  const u = computeUncertainty({
    bootstrapProps: [0.2, 0.8],
    innerSims: 100,
    pointEstimate: 0.5,
    numSimulations: 10_000,
  })
  check('u ci lo',      round(u.passProbCI[0]), 21.5)
  check('u ci hi',      round(u.passProbCI[1]), 78.5)
  check('u ci width',   round(u.ciWidth), 57)
  check('u mcStdErr',   round(u.mcStdErr), 0.5)
  check('u estStdErr',  round(u.estimationStdErr), 42.2374)
}

// Degenerate: zero spread across replicates. estimationVar clamps at 0
// rather than going negative when innerNoise exceeds observed variance.
{
  const u = computeUncertainty({
    bootstrapProps: [0.5, 0.5, 0.5],
    innerSims: 100,
    pointEstimate: 0.5,
    numSimulations: 10_000,
  })
  check('degenerate estStdErr', u.estimationStdErr, 0)
  check('degenerate width',     u.ciWidth, 0)
}

// Empty bootstrap (the failure path) must not throw.
{
  const u = computeUncertainty({
    bootstrapProps: [],
    innerSims: 300,
    pointEstimate: 0.7,
    numSimulations: 10_000,
  })
  check('empty ci',    u.passProbCI, [0, 0])
  check('empty width', u.ciWidth, 0)
}

// ---------- assessAdequacy ----------
const healthy = { tradeCount: 200, distinctDays: 60, stopsPresent: 200, bootstrapReps: BOOTSTRAP_REPS }
check('verdict adequate',       assessAdequacy({ ...healthy, ciWidth: 5 }).verdict, 'adequate')
check('verdict adequate bound', assessAdequacy({ ...healthy, ciWidth: 10 }).verdict, 'adequate')
check('verdict directional',    assessAdequacy({ ...healthy, ciWidth: 15 }).verdict, 'directional')
check('verdict direct bound',   assessAdequacy({ ...healthy, ciWidth: 20 }).verdict, 'directional')
check('verdict insufficient',   assessAdequacy({ ...healthy, ciWidth: 20.1 }).verdict, 'insufficient')
check('healthy no blockers',    assessAdequacy({ ...healthy, ciWidth: 5 }).blockers, [])
check('healthy keeps table',    assessAdequacy({ ...healthy, ciWidth: 5 }).suppressRiskComparison, false)

// A zero-width CI means the bootstrap produced no spread — that is a failure
// to measure, not evidence of precision. It must never read 'adequate'.
check('zero width is insufficient', assessAdequacy({ ...healthy, ciWidth: 0 }).verdict, 'insufficient')

// Incomplete bootstrap is untrustworthy regardless of the width it produced.
check(
  'short bootstrap insufficient',
  assessAdequacy({ ...healthy, ciWidth: 5, bootstrapReps: 250 }).verdict,
  'insufficient',
)

// The live shape as of 2026-10-30: 47 trades, 8 days, 11 usable stops.
// ciWidth 43 > CI_DIRECTIONAL_MAX_WIDTH (20) → verdict 'insufficient' from width alone.
// bootstrapReps === BOOTSTRAP_REPS and ciWidth !== 0, so no bootstrap blocker fires.
// Only stop-coverage blocker (11/47 ≈ 23%) and distinct-days blocker (8 < 20) fire → 2 blockers.
{
  const a = assessAdequacy({
    ciWidth: 43,
    tradeCount: 47,
    distinctDays: 8,
    stopsPresent: 11,
    bootstrapReps: BOOTSTRAP_REPS,
  })
  check('live verdict',    a.verdict, 'insufficient')
  check('live coverage',   round(a.stopCoverage, 4), 0.234)
  check('live suppresses', a.suppressRiskComparison, true)
  check('live blocker ct', a.blockers.length, 2)
}

// ---------- Fix 1: distinctDays cap ----------

// A narrow CI (adequate width) with too few trading days must be capped to
// 'directional' — the tight interval reflects one regime, not real precision.
check(
  'narrow ci few days yields directional',
  assessAdequacy({ ...healthy, distinctDays: 8, ciWidth: 5 }).verdict,
  'directional',
)

// The same narrow CI with enough trading days must still reach 'adequate' —
// the cap is a ceiling on 'adequate', not a blanket downgrade.
check(
  'narrow ci enough days still adequate',
  assessAdequacy({ ...healthy, distinctDays: 20, ciWidth: 5 }).verdict,
  'adequate',
)

// The cap must not upgrade: an 'insufficient' verdict from a short bootstrap
// combined with few distinct days must stay 'insufficient', not become
// 'directional'.
check(
  'short bootstrap few days stays insufficient',
  assessAdequacy({ ...healthy, distinctDays: 8, ciWidth: 5, bootstrapReps: 250 }).verdict,
  'insufficient',
)

// ---------- Fix 2: suppressRiskComparison on insufficient ----------

// When the verdict is 'insufficient' but stop coverage is fine, the risk
// comparison table must still be suppressed — printing per-level pass
// percentages for an unestimable probability is worse than the stop-coverage
// case, not better.
{
  const a = assessAdequacy({
    ciWidth: 43,
    tradeCount: 200,
    distinctDays: 60,
    stopsPresent: 200,   // coverage = 1.0, well above MIN_STOP_COVERAGE
    bootstrapReps: BOOTSTRAP_REPS,
  })
  check('insufficient suppresses despite good coverage', a.suppressRiskComparison, true)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
