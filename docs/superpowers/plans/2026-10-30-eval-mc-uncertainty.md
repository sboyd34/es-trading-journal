# Eval Monte Carlo — Honest Uncertainty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/api/backtest/eval-monte-carlo` report a real confidence interval around its pass probability, and refuse to render a precise headline number when the underlying sample is too thin to support one.

**Architecture:** Extract the statistical core into a pure, independently testable `lib/eval-uncertainty.ts` module (following the `lib/edge-stats.ts` precedent). The route gains a nested bootstrap — resample the trade set, re-simulate, repeat — and derives a 95% percentile CI plus a variance decomposition that separates simulation error from sample-size error. A self-calibrating adequacy gate keyed on CI width drives three UI render branches. Dead `combined` source toggle is deleted; hardcoded equity snapshots are read from `apex_accounts`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase, Tailwind, Recharts. Tests run via `node` native TypeScript stripping (Node 22.18+) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-30-eval-mc-uncertainty-design.md`

## Global Constraints

- **`npm run build` is the gating check before any push.** It runs lint + type-check + compile. `npx tsc --noEmit` alone is NOT sufficient — it skips ESLint, so `no-unused-vars` / `no-explicit-any` / hook-deps failures pass locally then break the production deploy.
- **No new npm dependencies.** No new DB columns, no new migrations.
- **Compute in proportions (0–1); convert to percentage points (0–100) exactly once**, immediately before placing a value on the API response. A variance term converted with `× 100` instead of `× 100²` is the likeliest bug in this change.
- **No TypeScript `enum`** in `lib/eval-uncertainty.ts` — Node's type stripping does not support it. Use string union types.
- **Test files use the `.mts` extension.** Verified: `tsc --noEmit` does not match `.mts` against its `include: ["**/*.ts"]` glob, so test files cannot break the build; and `node scripts/foo.mts` runs them directly. Imports inside `.mts` files MUST carry the explicit `.ts` extension (`from '../lib/eval-uncertainty.ts'`) because Node's ESM loader requires it.
- **Production `.ts`/`.tsx` imports stay extensionless** (`from '@/lib/eval-uncertainty'`) — `moduleResolution: "bundler"` rejects `.ts` extensions without `allowImportingTsExtensions`.
- **Atomic commits.** Title format `<Area>: <imperative phrase>`. Body explains *why*, not *what*. Trailer: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`. No trailing summaries in commit bodies.
- **Instrument point values are `{ ES: 50, MES: 5, NQ: 20, MNQ: 2 }`** and P&L comes from Postgres generated columns — never recalculated in application code.
- Thresholds, verbatim: `CI_ADEQUATE_MAX_WIDTH = 10`, `CI_DIRECTIONAL_MAX_WIDTH = 20`, `MIN_STOP_COVERAGE = 0.5`, `MIN_DISTINCT_DAYS = 20`, `BOOTSTRAP_REPS = 300`, `BOOTSTRAP_INNER_SIMS = 300`.

---

### Task 1: Pure statistical core — `lib/eval-uncertainty.ts`

**Why this is its own task:** the bootstrap math is the only part of this change that can be verified by assertion rather than by eyeball. Isolating it behind a pure interface means a reviewer can reject the statistics without rejecting the UI, and vice versa.

**Files:**
- Create: `lib/eval-uncertainty.ts`
- Create: `scripts/test-eval-uncertainty.mts`

**Interfaces:**
- Consumes: nothing (pure module — no Supabase, no Next, no I/O).
- Produces:
  ```ts
  export const BOOTSTRAP_REPS: number              // 300
  export const BOOTSTRAP_INNER_SIMS: number        // 300
  export const CI_ADEQUATE_MAX_WIDTH: number       // 10
  export const CI_DIRECTIONAL_MAX_WIDTH: number    // 20
  export const MIN_STOP_COVERAGE: number           // 0.5
  export const MIN_DISTINCT_DAYS: number           // 20

  export type AdequacyVerdict = 'adequate' | 'directional' | 'insufficient'

  export function quantile(sorted: number[], p: number): number

  export interface UncertaintyInput {
    bootstrapProps: number[]
    innerSims: number
    pointEstimate: number
    numSimulations: number
  }
  export interface UncertaintyResult {
    passProbCI: [number, number]
    mcStdErr: number
    estimationStdErr: number
    ciWidth: number
  }
  export function computeUncertainty(i: UncertaintyInput): UncertaintyResult

  export interface AdequacyInput {
    ciWidth: number
    tradeCount: number
    distinctDays: number
    stopsPresent: number
    bootstrapReps: number
  }
  export interface Adequacy {
    verdict: AdequacyVerdict
    ciWidth: number
    tradeCount: number
    distinctDays: number
    stopCoverage: number
    suppressRiskComparison: boolean
    blockers: string[]
  }
  export function assessAdequacy(i: AdequacyInput): Adequacy
  ```

**Note on a deliberate deviation from the spec:** the spec's response shape omitted `suppressRiskComparison`. It is added here so the `MIN_STOP_COVERAGE` threshold lives in exactly one place rather than being re-derived in JSX.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-eval-uncertainty.mts`:

```ts
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
check('q no floor bias', quantile(b300, 0.025), 7.475)
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
  check('live blocker ct', a.blockers.length, 3)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/test-eval-uncertainty.mts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../lib/eval-uncertainty.ts` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/eval-uncertainty.ts`:

```ts
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
/** Below this fraction of trades carrying a real stop, risk comparison is circular. */
export const MIN_STOP_COVERAGE = 0.5
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
  stopsPresent: number
  bootstrapReps: number
}

export interface Adequacy {
  verdict: AdequacyVerdict
  ciWidth: number
  tradeCount: number
  distinctDays: number
  stopCoverage: number
  suppressRiskComparison: boolean
  blockers: string[]
}

export function assessAdequacy(i: AdequacyInput): Adequacy {
  const { ciWidth, tradeCount, distinctDays, stopsPresent, bootstrapReps } = i
  const stopCoverage = tradeCount > 0 ? stopsPresent / tradeCount : 0
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

  if (stopCoverage < MIN_STOP_COVERAGE) {
    blockers.push(
      `Only ${stopsPresent} of ${tradeCount} trades have a usable stop (${Math.round(stopCoverage * 100)}%). ` +
        `R-multiples on the rest are net P&L ÷ assumed risk, so risk-sizing comparisons are circular.`,
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
    stopCoverage,
    suppressRiskComparison: stopCoverage < MIN_STOP_COVERAGE,
    blockers,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/test-eval-uncertainty.mts`
Expected: every line `PASS`, final line `ALL PASS`, exit code 0.

If `live blocker ct` fails with actual `2`: the live case has `ciWidth: 43` which is > 20 so it is already `insufficient` *without* a bootstrap blocker — meaning only the stop-coverage and distinct-days blockers fire, giving 2. Correct the expectation to `2` rather than weakening the implementation; `bootstrapReps === BOOTSTRAP_REPS` and `ciWidth !== 0`, so no bootstrap blocker is appropriate there.

- [ ] **Step 5: Confirm the test file cannot break the build**

Run: `npx tsc --noEmit 2>&1 | grep -i "test-eval-uncertainty" || echo "NOT TYPE-CHECKED (clean)"`
Expected: `NOT TYPE-CHECKED (clean)` — `.mts` is outside the `include: ["**/*.ts"]` glob.

- [ ] **Step 6: Run the gating check**

Run: `npm run build`
Expected: succeeds. `lib/eval-uncertainty.ts` is unreferenced at this point, which is fine — it is a module, not dead code in a bundle.

- [ ] **Step 7: Commit**

```bash
git add lib/eval-uncertainty.ts scripts/test-eval-uncertainty.mts
git commit -m "$(cat <<'EOF'
Eval MC: add pure uncertainty module with assertions

The simulator's error bar only ever described simulation noise. Splitting
the variance into a sample-size term and a sim-count term needs real
arithmetic, so it lives in a pure module that can be checked by assertion
rather than by eyeball.

Node 22 strips types natively and tsc's include glob skips .mts, so the
test runs against the shipped code with no new dependencies and no risk
to the build.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Nested bootstrap in the route

**Files:**
- Modify: `app/api/backtest/eval-monte-carlo/route.ts`

**Interfaces:**
- Consumes: `computeUncertainty`, `assessAdequacy`, `BOOTSTRAP_REPS`, `BOOTSTRAP_INNER_SIMS`, type `Adequacy` from `@/lib/eval-uncertainty` (Task 1).
- Produces: `EvalMonteCarloResponse` gains `passProbCI: [number, number]`, `mcStdErr: number`, `estimationStdErr: number`, `bootstrapReps: number`, `adequacy: Adequacy`; and **loses** `source` and `combinedCaveat`. `EvalSimInput` loses `source`. Tasks 4 and 5 consume this shape.

- [ ] **Step 1: Add the import and delete the dead `source` plumbing**

In `app/api/backtest/eval-monte-carlo/route.ts`, add after the existing imports (line 4):

```ts
import {
  computeUncertainty,
  assessAdequacy,
  BOOTSTRAP_REPS,
  BOOTSTRAP_INNER_SIMS,
  type Adequacy,
} from '@/lib/eval-uncertainty'
```

Remove `source: 'live' | 'combined'` from `EvalSimInput` (line 29).

Replace the `EvalMonteCarloResponse` fields `source: 'live' | 'combined'` and `combinedCaveat: boolean` (lines 51-52) with:

```ts
  passProbCI: [number, number]
  mcStdErr: number
  estimationStdErr: number
  bootstrapReps: number
  adequacy: Adequacy
```

In the `POST` handler, delete `source: body.source === 'combined' ? 'combined' : 'live',` (line 215) and the entire `if (input.source === 'combined') { … }` block that queries `backtest_trades` (lines 235-241).

**Why delete rather than gate:** `backtest_trades` has zero rows, so the toggle changes nothing while rendering a caveat implying it did. Dead UI that lies is worse than absent UI.

- [ ] **Step 2: Add `date` to the trades select so distinct days can be counted**

Change the select on line 221 from:

```ts
      .select('net_pnl, entry_price, stop_loss, quantity, instrument, mfe')
```

to:

```ts
      .select('net_pnl, entry_price, stop_loss, quantity, instrument, mfe, date')
```

Add `date: string | null` to the `RawRow` type (lines 224-231).

- [ ] **Step 3: Add the bootstrap function**

Insert after `buildComparison` (after line 197):

```ts
/**
 * Outer bootstrap: resample the trade set with replacement and re-simulate,
 * yielding one pass proportion per replicate.
 *
 * Resampling with replacement means some replicates draw zero of the trades
 * that carry a real stop, or zero MFE-eligible ones. That is the mechanism,
 * not a bug — the fragility of a small subset propagates into the interval
 * instead of hiding behind the point estimate.
 *
 * Inner runs pass collectFan=false: the fan arrays are the bulk of the
 * allocation cost and nothing here reads them.
 */
function bootstrapPassProps(samples: RSample[], input: EvalSimInput): number[] {
  const n = samples.length
  const innerInput: EvalSimInput = { ...input, numSimulations: BOOTSTRAP_INNER_SIMS }
  const props: number[] = []

  for (let b = 0; b < BOOTSTRAP_REPS; b++) {
    const resampled: RSample[] = new Array(n)
    for (let i = 0; i < n; i++) {
      resampled[i] = samples[Math.floor(Math.random() * n)]
    }
    const r = simulate(resampled, innerInput, input.riskPerTrade, false)
    props.push(r.passCount / BOOTSTRAP_INNER_SIMS)
  }

  return props
}
```

- [ ] **Step 4: Wire it into the response**

After `const rComparison = buildComparison(samples, input)` (line 304), insert:

```ts
    const distinctDays = new Set(
      rawTrades.map(t => t.date).filter((d): d is string => d != null),
    ).size

    // A bootstrap failure must not fail the request. A broken error bar is not
    // a reason to withhold the simulation — it is a reason to refuse to render
    // a precise number, which assessAdequacy handles via bootstrapReps === 0.
    let bootstrapProps: number[] = []
    try {
      bootstrapProps = bootstrapPassProps(samples, input)
    } catch {
      bootstrapProps = []
    }

    const pointEstimate = mainResult.passCount / numSimulations
    const uncertainty = computeUncertainty({
      bootstrapProps,
      innerSims: BOOTSTRAP_INNER_SIMS,
      pointEstimate,
      numSimulations,
    })
    const adequacy = assessAdequacy({
      ciWidth: uncertainty.ciWidth,
      tradeCount: samples.length,
      distinctDays,
      stopsPresent: stopCount,
      bootstrapReps: bootstrapProps.length,
    })
```

In the `NextResponse.json({ … })` literal, remove the `source` and `combinedCaveat` lines and add:

```ts
      passProbCI:       uncertainty.passProbCI,
      mcStdErr:         uncertainty.mcStdErr,
      estimationStdErr: uncertainty.estimationStdErr,
      bootstrapReps:    bootstrapProps.length,
      adequacy,
```

- [ ] **Step 5: Verify the gating check passes**

Run: `npm run build`
Expected: succeeds. If it reports unused `COMPARISON_RISKS` or an unused import, that means Step 1's deletions removed a last reference — remove the now-orphaned declaration too (clean up only what these changes orphaned).

The page still sends `source` in its POST body and reads `result.source`; that is expected to break type-check in Task 4, not here. If `npm run build` fails on `app/(app)/backtest/eval/page.tsx`, proceed to Task 4 and treat Tasks 2+4 as one commit rather than leaving `main` unbuildable.

- [ ] **Step 6: Wall-clock the route against the ≈1.8× estimate**

Start the dev server (`npm run dev`), sign in, open `/backtest/eval`, run a simulation with DevTools Network open, and record the request duration. The spec estimates ≈1.8× the previous cost (adding 300×300 = 90,000 fan-less paths to the existing 5×10,000). Vercel's default function timeout is 300s, so there is ample headroom — but record the real number rather than assuming it.

- [ ] **Step 7: Commit**

```bash
git add app/api/backtest/eval-monte-carlo/route.ts
git commit -m "$(cat <<'EOF'
Eval MC: bootstrap a real interval around pass probability

Pass probability was reported to a tenth of a point off 10,000 sims, but
that precision only ever described simulation noise -- it said nothing
about resting on 47 trades from 8 days. Resampling the trade set and
re-simulating propagates sample-size uncertainty into the estimate, which
is the error term that actually dominates.

Drops the combined-source toggle in the same change: backtest_trades has
no rows, so selecting it changed nothing while rendering a caveat that
implied it had.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Read equity and threshold from `apex_accounts`

**Files:**
- Modify: `app/api/backtest/eval-monte-carlo/route.ts`
- Modify: `app/(app)/backtest/eval/page.tsx:~30-45` (the `useState` defaults)

**Interfaces:**
- Consumes: `APEX_CONFIGS` from `@/lib/apex-config`; the `apex_accounts` table.
- Produces: no new exports. Changes only the *defaults* used when the request body omits a field.

**Context:** `route.ts:212-213` hardcodes `currentEquity: 251_636.10` and `currentThreshold: 245_136.10` — a snapshot of one account on one day baked into source, duplicated again in the page's `useState`. The `apex_accounts` table already carries what these should be derived from: `account_size`, `starting_balance`, `current_balance`, `highest_balance`. And `APEX_CONFIGS` is keyed by account size — `APEX_CONFIGS[250000]` is `{ profitTarget: 15000, trailingDrawdown: 6500, … }`, which is exactly where the other three hardcoded defaults came from.

- [ ] **Step 1: Add the import**

In `route.ts`:

```ts
import { APEX_CONFIGS, type AccountSize } from '@/lib/apex-config'
```

- [ ] **Step 2: Fetch the account before building `input`**

Insert immediately after the auth check (after line 203), before `const body = …`:

```ts
    // Defaults come from the user's actual Apex account rather than a
    // hardcoded snapshot. Most-recently-updated row wins when several exist.
    const { data: acct } = await supabase
      .from('apex_accounts')
      .select('account_size, starting_balance, current_balance, highest_balance')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const acctSize = (acct?.account_size ?? 250_000) as AccountSize
    const cfg = APEX_CONFIGS[acctSize] ?? APEX_CONFIGS[250_000]
    const dfltStartingEquity = acct?.starting_balance ?? acctSize
    const dfltCurrentEquity = acct?.current_balance ?? dfltStartingEquity
    // Apex trails the threshold on the high-water mark and freezes it at
    // startingEquity + 100. Derive rather than store: highest_balance is the
    // HWM the tracker already maintains.
    const hwm = acct?.highest_balance ?? dfltCurrentEquity
    const dfltCurrentThreshold = Math.min(
      hwm - cfg.trailingDrawdown,
      dfltStartingEquity + 100,
    )
```

- [ ] **Step 3: Use the derived defaults**

Replace the `input` literal's hardcoded fallbacks (lines 207-213) so each `??` falls back to the derived value:

```ts
      startingEquity:   body.startingEquity   ?? dfltStartingEquity,
      profitTarget:     body.profitTarget     ?? cfg.profitTarget,
      trailingDrawdown: body.trailingDrawdown ?? cfg.trailingDrawdown,
      riskPerTrade:     body.riskPerTrade     ?? 500,
      tradesPerDay:     body.tradesPerDay     ?? 2.5,
      currentEquity:    body.currentEquity    ?? dfltCurrentEquity,
      currentThreshold: body.currentThreshold ?? dfltCurrentThreshold,
```

- [ ] **Step 4: Remove the duplicated magic numbers from the page**

In `app/(app)/backtest/eval/page.tsx`, change the two `useState` initialisers that read `useState(251_636.10)` and `useState(245_136.10)` to `useState<number | null>(null)`, and have `runSimulation` omit those keys from the POST body when `null` so the server-derived defaults apply. Render the `NumInput` with `value={currentEquity ?? 0}` and a placeholder note that a blank value uses the account's live balance.

**Note:** `ReferenceLine y={currentThreshold}` on the fan chart (page.tsx:265) must not be fed `null`. Prefer the value the server echoed back for the run being displayed over the local input state.

- [ ] **Step 5: Verify**

Run: `npm run build`
Then: `npm run dev`, open `/backtest/eval`, confirm the inputs prefill or blank-default sensibly and a run with untouched inputs still completes.

- [ ] **Step 6: Commit**

```bash
git add app/api/backtest/eval-monte-carlo/route.ts "app/(app)/backtest/eval/page.tsx"
git commit -m "$(cat <<'EOF'
Eval MC: derive account defaults instead of hardcoding a snapshot

currentEquity and currentThreshold were one account's balances on one day,
written into source in two places. They drift silently the moment the
account moves, and nothing signals it. apex_accounts already tracks the
balances and APEX_CONFIGS already keys the drawdown by account size.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Gate-aware UI on the eval page

**Files:**
- Modify: `app/(app)/backtest/eval/page.tsx` — headline block (209-233), stability caveat (200-206), combined caveat (191-197), source select (160-171), `passProbColor`, risk table (288-339)

**Interfaces:**
- Consumes: `result.adequacy`, `result.passProbCI`, `result.mcStdErr`, `result.estimationStdErr` from Task 2.
- Produces: writes `{ passProb, passProbCI, verdict, riskPerTrade, runAt }` to `localStorage['apex.eval.lastResult']`, consumed by Task 5.

**Verification model:** there is no component test harness in this project and none is being added. Per CLAUDE.md the QA model is `npm run build` plus manual browser verification, so these steps verify by building and looking.

- [ ] **Step 1: Remove the dead source select and combined caveat**

Delete the `<div>` wrapping the "R Distribution Source" `<label>` + `<select>` (lines 161-171), the `source` / `setSource` state, `source` from the POST body, and the entire `{result.combinedCaveat && (…)}` block (lines 191-197).

- [ ] **Step 2: Extend `passProbColor` with a fourth state**

```ts
function passProbColor(p: number): string {
  if (p >= 60) return 'text-emerald-400'
  if (p >= 35) return 'text-amber-400'
  return 'text-red-400'
}

// Gray is not "a bad number" — it is "no number is warranted".
function verdictColor(v: 'adequate' | 'directional' | 'insufficient', p: number): string {
  return v === 'insufficient' ? 'text-gray-400' : passProbColor(p)
}
```

- [ ] **Step 3: Replace the stability caveat with the quantified decomposition**

Replace the block at lines 200-206 with:

```tsx
          <div className="bg-gray-800/30 border border-gray-700/40 rounded-lg px-4 py-2.5 text-xs text-gray-500 space-y-1">
            <p>
              <span className="text-gray-400 font-medium">Where the error comes from:</span>{' '}
              <span className="text-gray-300 font-medium">±{result.mcStdErr.toFixed(2)}pt</span>{' '}
              from running {numSimulations.toLocaleString()} simulations ·{' '}
              <span className="text-gray-300 font-medium">±{result.estimationStdErr.toFixed(1)}pt</span>{' '}
              from having only {result.adequacy.tradeCount} trades across{' '}
              {result.adequacy.distinctDays} days. More simulations shrink the first number
              and leave the second untouched.
            </p>
            <p className="text-gray-600">{result.riskInferenceNote}</p>
          </div>
```

- [ ] **Step 4: Make the headline gate-aware**

Replace the pass-probability cell (lines 211-219) with three branches:

```tsx
              <div className="col-span-2 md:col-span-1 flex flex-col justify-center">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Pass Probability</p>

                {result.adequacy.verdict === 'adequate' && (
                  <>
                    <p className={cn('text-5xl font-bold tabular-nums', passProbColor(result.passProb))}>
                      {result.passProb.toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      ± {result.estimationStdErr.toFixed(1)}pt
                    </p>
                  </>
                )}

                {result.adequacy.verdict === 'directional' && (
                  <>
                    <p className="text-4xl font-bold tabular-nums text-amber-400">
                      {result.passProbCI[0].toFixed(0)}–{result.passProbCI[1].toFixed(0)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      directional only · point estimate {result.passProb.toFixed(1)}%
                    </p>
                  </>
                )}

                {result.adequacy.verdict === 'insufficient' && (
                  <>
                    <p className="text-2xl font-bold text-gray-400">Not enough data</p>
                    <p className="text-xs text-gray-500 mt-1">
                      95% interval spans {result.passProbCI[0].toFixed(0)}–
                      {result.passProbCI[1].toFixed(0)}% — too wide to act on
                    </p>
                  </>
                )}

                <p className="text-xs text-gray-500 mt-2">
                  ${riskPerTrade}/trade · {numSimulations.toLocaleString()} sims
                </p>
              </div>
```

- [ ] **Step 5: Add the "what's missing" panel**

Immediately after the headline card's closing `</div>`, add:

```tsx
          {result.adequacy.blockers.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-amber-300 mb-2">What&rsquo;s missing</p>
              <ul className="space-y-1.5">
                {result.adequacy.blockers.map((b, i) => (
                  <li key={i} className="text-xs text-amber-400/90 flex gap-2">
                    <span className="text-amber-500">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
```

**Lint note:** bare `'` in JSX text trips `react/no-unescaped-entities`. Use `&rsquo;` as above.

- [ ] **Step 6: Gate the risk comparison table**

Wrap the risk comparison card (lines 288-339) in `{!result.adequacy.suppressRiskComparison && ( … )}` and add the explanatory replacement:

```tsx
          {result.adequacy.suppressRiskComparison && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-200">Risk Per Trade Comparison</h2>
              <p className="text-xs text-gray-500 mt-1">
                Hidden: only {result.adequacy.tradeCount > 0
                  ? Math.round(result.adequacy.stopCoverage * 100)
                  : 0}% of trades have a usable stop. For the rest, R is net P&amp;L ÷ the
                assumed risk, so replaying them at a different risk level just rescales the
                same number. The comparison would show arithmetic, not evidence.
              </p>
            </div>
          )}
```

- [ ] **Step 7: Extend the localStorage payload**

In `runSimulation`, change the write to:

```ts
      localStorage.setItem(LS_KEY, JSON.stringify({
        passProb: data.passProb,
        passProbCI: data.passProbCI,
        verdict: data.adequacy.verdict,
        riskPerTrade,
        runAt: new Date().toISOString(),
      }))
```

Note `source` is gone from the payload; Task 5 handles the shape change.

- [ ] **Step 8: Verify**

Run: `npm run build` — must pass (this is the gating check; watch specifically for `react/no-unescaped-entities` and unused-var errors from the Step 1 deletions).

Then `npm run dev`, open `/backtest/eval`, run a simulation, and confirm against live data (47 trades, 11 stops): headline reads "Not enough data", the what's-missing panel lists the stop-coverage and distinct-days blockers, the risk table is replaced by the explanation, and no source dropdown remains.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/backtest/eval/page.tsx"
git commit -m "$(cat <<'EOF'
Eval MC: let the page refuse to show a number it can't support

A 73.4% that could honestly be 45% or 88% is worse than no number -- it
reads as precision and invites sizing decisions the sample cannot carry.
The headline now follows the interval: point estimate when it is tight, a
range when it is loose, and a plain refusal plus what is missing when it
is too wide to act on.

The risk-sizing table hides below 50% stop coverage because it is an
identity function there: R is net P&L over the assumed risk, so replaying
at another risk level rescales the same figure.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Qualify the dashboard card

**Files:**
- Modify: `components/dashboard/EvalPassOddsCard.tsx`

**Interfaces:**
- Consumes: the `localStorage['apex.eval.lastResult']` payload from Task 4 — `{ passProb, passProbCI, verdict, riskPerTrade, runAt }`.
- Produces: nothing.

**Why this matters most:** this card renders a bare `73.4%` on the dashboard every morning with no caveat at all. It is the most-seen and least-qualified surface in the feature.

- [ ] **Step 1: Update the payload type and add the verdict branch**

Replace the `LastRun` interface and the render body:

```tsx
interface LastRun {
  passProb: number
  passProbCI?: [number, number]
  verdict?: 'adequate' | 'directional' | 'insufficient'
  riskPerTrade: number
  runAt: string
}
```

`passProbCI` and `verdict` are optional so a payload written before this change
does not throw. Treat a missing `verdict` as `'insufficient'` — an unqualified
number from the old shape is exactly what this change exists to stop showing.

Replace the number block:

```tsx
        {lastRun.verdict === 'insufficient' || !lastRun.verdict ? (
          <>
            <p className="text-2xl font-bold text-gray-400 mt-0.5">
              {lastRun.passProbCI
                ? `${lastRun.passProbCI[0].toFixed(0)}–${lastRun.passProbCI[1].toFixed(0)}%`
                : '—'}
            </p>
            <span className="inline-block mt-1 text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-semibold">
              needs more data
            </span>
          </>
        ) : (
          <p className={cn('text-3xl font-bold tabular-nums mt-0.5', passProbColor(lastRun.passProb))}>
            {lastRun.passProb.toFixed(1)}%
          </p>
        )}
```

- [ ] **Step 2: Drop `source` from the footer line**

The payload no longer carries `source`. Change the footer to:

```tsx
        <p className="text-[10px] text-gray-600 mt-1">
          ${lastRun.riskPerTrade}/trade · {ageLabel}
        </p>
```

- [ ] **Step 3: Verify**

Run: `npm run build` — must pass.

Then in the dev browser:
1. `localStorage.removeItem('apex.eval.lastResult')` → reload `/dashboard` → card renders nothing (silent-when-clean).
2. Set a stale pre-change payload: `localStorage.setItem('apex.eval.lastResult', JSON.stringify({passProb:73.4,riskPerTrade:500,source:'live',runAt:new Date().toISOString()}))` → reload → card shows `—` with the "needs more data" chip, **not** `73.4%`.
3. Run a real simulation on `/backtest/eval`, return to `/dashboard` → card reflects the live verdict.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/EvalPassOddsCard.tsx
git commit -m "$(cat <<'EOF'
Eval MC: stop the dashboard card asserting unearned precision

This card is the most-seen surface in the feature and carried the least
qualification -- a bare pass percentage every morning with no interval and
no caveat. It now mirrors the eval page's verdict, and treats a payload
written before this change as unqualified rather than trustworthy.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification

Mirrors the spec's Verification section. Run after all five tasks.

- [ ] `node scripts/test-eval-uncertainty.mts` → `ALL PASS`
- [ ] `npm run build` → succeeds
- [ ] Run on live data (47 trades / 8 days / 11 stops): `verdict: 'insufficient'`, no headline percentage, risk comparison suppressed, blockers name stop coverage and distinct days
- [ ] `mcStdErr` is sub-1pt while `estimationStdErr` is an order of magnitude larger — that gap is the entire point of the change
- [ ] Re-run at `numSimulations` 1,000 vs 20,000: `mcStdErr` shrinks visibly, `passProbCI` width barely moves. **If the CI narrows materially with more sims, the decomposition is wrong** — stop and re-derive rather than shipping
- [ ] `/dashboard` card no longer shows a bare percentage
- [ ] Route wall-clock recorded and compared against the ≈1.8× estimate

## Out of Scope

Carried from the spec, listed so an executor does not drift into them:

- No accuracy improvement — this widens the reported interval, it does not move the point estimate
- No day-block / stationary bootstrap (measured unsupported at 8 distinct days; revisit at ~50)
- No `stop_loss` capture fix — that is the change that actually narrows the interval, and it is the next piece of work
- No changes to `components/reports/MonteCarloTab.tsx` (separate, distinct problems)
- No freeze-rule verification — the `freezeThreshold = startingEquity + 100` comment at `route.ts:86-89` still warrants checking against the current Apex agreement
- No new DB columns, migrations, or npm dependencies
