export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  computeUncertainty,
  assessAdequacy,
  BOOTSTRAP_REPS,
  BOOTSTRAP_INNER_SIMS,
  type Adequacy,
} from '@/lib/eval-uncertainty'
import { APEX_CONFIGS, TRADING_PLAN, planFor, type AccountSize, type PlanSize } from '@/lib/apex-config'
import { buildRSamples, type RSample, type SampleTrade } from '@/lib/eval-samples'

// The plan's max per-trade risk on the 25K ($75) and 50K ($125), then 2x and
// 4x the 50K figure for contrast (trading_plan_apex_50k.pdf).
const COMPARISON_RISKS = [75, 125, 250, 500]
// Sampled trading days for the fan chart (25 checkpoints over 120 days)
const FAN_DAYS = [
  0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
  65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120,
]

// The trading plan's DAILY rules (TRADING_PLAN). When set, the simulation is
// structured into real days: each day ends at its trade quota OR when the
// first rule fires, and the rest of that day is skipped. The profit target
// fires at the low end of the plan's range, as in Plan Replay.
export interface PlanRules {
  dailyLossHard: number
  maxLosers: number
  dailyProfitTarget: number
}

export interface EvalSimInput {
  startingEquity: number
  profitTarget: number
  trailingDrawdown: number
  riskPerTrade: number
  tradesPerDay: number
  currentEquity: number
  currentThreshold: number
  numSimulations: number
  planRules: PlanRules | null
}

export interface OutcomeSummary {
  passProb: number
  failProb: number
  timeoutProb: number
  medianDaysToPass: number | null
}

export interface ComboComparison {
  riskPerTrade: number
  passProb: number
  failProb: number
  timeoutProb: number
  medianDaysToPass: number | null
}

export interface EvalMonteCarloResponse {
  passProb: number
  failProb: number
  timeoutProb: number
  medianDaysToPass: number | null
  p10DaysToPass: number | null
  p90DaysToPass: number | null
  fanData: Array<{ day: number; p10: number; p25: number; p50: number; p75: number; p90: number }>
  rComparison: ComboComparison[]
  rSampleSize: number
  riskInferenceNote: string
  passProbCI: [number, number]
  mcStdErr: number
  estimationStdErr: number
  bootstrapReps: number
  adequacy: Adequacy
  resolvedThreshold: number
  resolvedPassLevel: number
  // Plan-aware: which rules drove the main result, and the same inputs run
  // both with and without them (null when the account size has no plan).
  planRulesApplied: boolean
  planRules: PlanRules | null
  planAccountSize: number | null
  planComparison: { withPlan: OutcomeSummary; withoutPlan: OutcomeSummary } | null
}

const MAX_DAYS = 120

// A finite number within [lo, hi], or the default when the input is missing,
// non-numeric, or non-finite.
function clampNum(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt
  return Math.min(Math.max(n, lo), hi)
}

// A fractional tradesPerDay (e.g. 2.5) becomes a per-day quota of 2 or 3
// with the right average, and never zero.
function drawQuota(tradesPerDay: number): number {
  const base = Math.floor(tradesPerDay)
  const quota = base + (Math.random() < tradesPerDay - base ? 1 : 0)
  return Math.max(1, quota)
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor(sorted.length * p)
  return sorted[Math.min(idx, sorted.length - 1)]
}

interface SimResult {
  passCount: number
  failCount: number
  timeoutCount: number
  daysToPass: number[]
  fanEquities: number[][]
}

function simulate(
  samples: RSample[],
  input: EvalSimInput,
  riskPerTrade: number,
  collectFan: boolean,
): SimResult {
  const {
    startingEquity,
    profitTarget,
    trailingDrawdown,
    tradesPerDay,
    currentEquity,
    currentThreshold,
    numSimulations,
    planRules,
  } = input

  const passLevel = startingEquity + profitTarget
  // FREEZE RULE (Apex LEGACY evaluation): the trail does not lock at
  // startingEquity + 100 — that is the PA rule. During the eval, Tradovate
  // accounts never stop trailing, and Rithmic/WealthCharts stop only when the
  // THRESHOLD reaches the profit target (e.g. $53,000 on the 50K). The
  // threshold sits a full drawdown below the peak, so neither can freeze
  // before the balance passes; capping at passLevel models both. Verify
  // against the current Apex agreement — they have revised trailing before.
  const freezeThreshold = passLevel
  // Plan mode: every day takes at most ceil(tradesPerDay) trades, so this cap
  // can never cut the run short of MAX_DAYS days.
  const maxTrades = planRules
    ? MAX_DAYS * Math.ceil(tradesPerDay)
    : Math.ceil(MAX_DAYS * tradesPerDay)
  const n = samples.length

  let passCount = 0
  let failCount = 0
  let timeoutCount = 0
  const daysToPass: number[] = []
  const fanEquities: number[][] = collectFan ? FAN_DAYS.map(() => []) : []

  // Map trade index → fan checkpoint array index for O(1) lookup
  const fanCheckpointMap = new Map<number, number>()
  if (collectFan) {
    FAN_DAYS.forEach((day, i) => {
      fanCheckpointMap.set(Math.round(day * tradesPerDay), i)
    })
  }
  // Plan mode records the fan at real day ends instead of trade counts.
  const fanByDay = new Map<number, number>()
  if (collectFan && planRules) FAN_DAYS.forEach((day, i) => { if (day > 0) fanByDay.set(day, i) })

  for (let sim = 0; sim < numSimulations; sim++) {
    let equity = currentEquity
    let equityHwm = currentEquity
    let threshold = currentThreshold

    let outcome: 'pass' | 'fail' | 'timeout' = 'timeout'
    let endTradeIdx = maxTrades

    // Plan-mode day state
    let day = 1
    let dayPnl = 0
    let dayLosers = 0
    let dayTrades = 0
    let quota = planRules ? drawQuota(tradesPerDay) : 0

    // Record day-0 equity
    if (collectFan) {
      const idx0 = fanCheckpointMap.get(0)
      if (idx0 !== undefined) fanEquities[idx0].push(equity)
    }

    for (let tradeIdx = 1; tradeIdx <= maxTrades; tradeIdx++) {
      const s = samples[Math.floor(Math.random() * n)]
      const equityBefore = equity

      // Intra-trade MFE ratchet for winning trades (Apex trails on unrealized
      // peaks). Gated on MFE presence alone — this used to also require a
      // stop, which silenced the ratchet on 36 of 48 trades and understated
      // the single mechanic most likely to fail an eval.
      if (s.r > 0 && s.mfeR !== null) {
        const intraPeak = equity + s.mfeR * riskPerTrade
        if (intraPeak > equityHwm) {
          equityHwm = intraPeak
          const newThreshold = Math.min(equityHwm - trailingDrawdown, freezeThreshold)
          if (newThreshold > threshold) threshold = newThreshold
        }
      }

      equity += s.r * riskPerTrade

      // Update HWM and threshold after trade settles
      if (equity > equityHwm) {
        equityHwm = equity
        const newThreshold = Math.min(equityHwm - trailingDrawdown, freezeThreshold)
        if (newThreshold > threshold) threshold = newThreshold
      }

      if (equity >= passLevel) {
        outcome = 'pass'
        endTradeIdx = tradeIdx
        break
      }
      if (equity <= threshold) {
        outcome = 'fail'
        endTradeIdx = tradeIdx
        break
      }

      if (planRules) {
        // The day ends at its quota or at the first plan rule to fire.
        const pnl = equity - equityBefore
        dayPnl += pnl
        if (pnl < 0) dayLosers++
        dayTrades++
        if (
          dayPnl <= -planRules.dailyLossHard ||
          dayLosers >= planRules.maxLosers ||
          dayPnl >= planRules.dailyProfitTarget ||
          dayTrades >= quota
        ) {
          if (collectFan) {
            const fanIdx = fanByDay.get(day)
            if (fanIdx !== undefined) fanEquities[fanIdx].push(equity)
          }
          day++
          dayPnl = 0
          dayLosers = 0
          dayTrades = 0
          quota = drawQuota(tradesPerDay)
          if (day > MAX_DAYS) break
        }
      } else if (collectFan) {
        const fanIdx = fanCheckpointMap.get(tradeIdx)
        if (fanIdx !== undefined) fanEquities[fanIdx].push(equity)
      }
    }

    // Fill remaining fan checkpoints with terminal equity for early-exit sims
    if (collectFan && outcome !== 'timeout') {
      FAN_DAYS.forEach((fanDay, i) => {
        const pending = planRules
          ? fanDay >= day && fanDay > 0 // that day had not ended when the sim stopped
          : Math.round(fanDay * tradesPerDay) > endTradeIdx
        if (pending) fanEquities[i].push(equity)
      })
    }

    if (outcome === 'pass') {
      passCount++
      daysToPass.push(planRules ? day : Math.ceil(endTradeIdx / tradesPerDay))
    } else if (outcome === 'fail') {
      failCount++
    } else {
      timeoutCount++
    }
  }

  return { passCount, failCount, timeoutCount, daysToPass, fanEquities }
}

function buildComparison(samples: RSample[], input: EvalSimInput): ComboComparison[] {
  return COMPARISON_RISKS.map(riskPerTrade => {
    const r = simulate(samples, input, riskPerTrade, false)
    const sorted = [...r.daysToPass].sort((a, b) => a - b)
    return {
      riskPerTrade,
      passProb: (r.passCount / input.numSimulations) * 100,
      failProb: (r.failCount / input.numSimulations) * 100,
      timeoutProb: (r.timeoutCount / input.numSimulations) * 100,
      medianDaysToPass: sorted.length > 0 ? pct(sorted, 0.5) : null,
    }
  })
}

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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Defaults come from the user's actual Apex account rather than a
    // hardcoded snapshot. Most-recently-updated row wins when several exist.
    const { data: acct, error: acctError } = await supabase
      .from('apex_accounts')
      .select('account_size, starting_balance, current_balance, highest_balance')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // A failed lookup still degrades to APEX_CONFIGS defaults rather than
    // failing the request, but it must not do so silently — otherwise a
    // user's real account size is replaced by a generic 250K with no signal.
    if (acctError) console.error('[eval-monte-carlo] apex_accounts lookup failed:', acctError)

    const acctSize = (acct?.account_size ?? 250_000) as AccountSize
    const cfg = APEX_CONFIGS[acctSize] ?? APEX_CONFIGS[250_000]
    const dfltStartingEquity  = acct?.starting_balance ?? acctSize
    const dfltCurrentEquity   = acct?.current_balance  ?? dfltStartingEquity
    // Apex trails the threshold on the high-water mark; during a legacy eval
    // it keeps trailing up to the pass level (see the freeze rule in
    // simulate). Derive rather than store: highest_balance is the HWM the
    // tracker already maintains.
    const hwm                 = acct?.highest_balance  ?? dfltCurrentEquity
    const dfltCurrentThreshold = Math.min(
      hwm - cfg.trailingDrawdown,
      dfltStartingEquity + cfg.profitTarget,
    )

    const body = await request.json().catch(() => ({}))

    // The plan for this account size (25K/50K only). Applied unless the
    // caller turns it off; both variants are returned for comparison anyway.
    const plan = TRADING_PLAN[acctSize as PlanSize]
    const accountPlanRules: PlanRules | null = plan
      ? {
          dailyLossHard: plan.dailyLossHard,
          maxLosers: plan.maxLosers,
          dailyProfitTarget: plan.dailyProfitTarget.min,
        }
      : null
    const applyPlanRules = body.applyPlanRules !== false && accountPlanRules !== null

    const input: EvalSimInput = {
      startingEquity:   body.startingEquity   ?? dfltStartingEquity,
      profitTarget:     body.profitTarget     ?? cfg.profitTarget,
      trailingDrawdown: body.trailingDrawdown ?? cfg.trailingDrawdown,
      riskPerTrade:     body.riskPerTrade     ?? planFor(acctSize).riskPerTrade.max,
      // tradesPerDay and numSimulations set the loop length, so both are
      // forced finite and bounded — Infinity or 1e9 would spin to the timeout.
      tradesPerDay:     clampNum(body.tradesPerDay, 2.5, 0.5, 20),
      currentEquity:    body.currentEquity    ?? dfltCurrentEquity,
      currentThreshold: body.currentThreshold ?? dfltCurrentThreshold,
      numSimulations:   Math.round(clampNum(body.numSimulations, 10_000, 1_000, 20_000)),
      planRules:        applyPlanRules ? accountPlanRules : null,
    }

    // Fetch live trades. stop_loss is deliberately not selected: see the
    // header of lib/eval-samples.ts for why per-trade stop risk is not a
    // usable denominator on this account.
    const { data: liveTrades } = await supabase
      .from('trades')
      .select('net_pnl, quantity, instrument, mfe, date')
      .eq('user_id', user.id)

    type RawRow = SampleTrade & { date: string | null }

    const rawTrades: RawRow[] = [...(liveTrades ?? [])] as RawRow[]

    const usableTrades = rawTrades.filter(t => t.net_pnl != null)

    const samples: RSample[] = buildRSamples(usableTrades, input.riskPerTrade)
    const excursionCount = samples.filter(s => s.mfeR !== null).length

    if (samples.length < 5) {
      return NextResponse.json(
        { error: 'Need at least 5 trades with P&L to build R distribution' },
        { status: 400 }
      )
    }

    const riskInferenceNote =
      `Replays realized net P&L across all ${samples.length} trades; ` +
      `$${input.riskPerTrade}/trade scales position size uniformly. ` +
      (excursionCount === samples.length
        ? `MFE recorded on all ${samples.length}, so the trailing-threshold ratchet is modeled on every winner.`
        : `MFE recorded on ${excursionCount} of ${samples.length} — the trailing-threshold ratchet is unmodeled on the rest, which understates fail risk.`)

    const mainResult = simulate(samples, input, input.riskPerTrade, true)
    const { numSimulations } = input
    const sortedDays = [...mainResult.daysToPass].sort((a, b) => a - b)

    const fanData = FAN_DAYS.map((day, i) => {
      const eq = [...mainResult.fanEquities[i]].sort((a, b) => a - b)
      return {
        day,
        p10: pct(eq, 0.1),
        p25: pct(eq, 0.25),
        p50: pct(eq, 0.5),
        p75: pct(eq, 0.75),
        p90: pct(eq, 0.9),
      }
    })

    const rComparison = buildComparison(samples, input)

    // Same samples, same inputs — with and without the plan's daily rules.
    // The main run already covers whichever mode is active.
    const summarize = (r: SimResult): OutcomeSummary => {
      const sorted = [...r.daysToPass].sort((a, b) => a - b)
      return {
        passProb: (r.passCount / input.numSimulations) * 100,
        failProb: (r.failCount / input.numSimulations) * 100,
        timeoutProb: (r.timeoutCount / input.numSimulations) * 100,
        medianDaysToPass: sorted.length > 0 ? pct(sorted, 0.5) : null,
      }
    }
    let planComparison: EvalMonteCarloResponse['planComparison'] = null
    if (accountPlanRules) {
      const other = simulate(samples, { ...input, planRules: applyPlanRules ? null : accountPlanRules }, input.riskPerTrade, false)
      planComparison = applyPlanRules
        ? { withPlan: summarize(mainResult), withoutPlan: summarize(other) }
        : { withPlan: summarize(other), withoutPlan: summarize(mainResult) }
    }

    const distinctDays = new Set(
      usableTrades.map(t => t.date).filter((d): d is string => d != null),
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
      excursionsPresent: excursionCount,
      bootstrapReps: bootstrapProps.length,
    })

    return NextResponse.json({
      passProb:         (mainResult.passCount / numSimulations) * 100,
      failProb:         (mainResult.failCount / numSimulations) * 100,
      timeoutProb:      (mainResult.timeoutCount / numSimulations) * 100,
      medianDaysToPass: sortedDays.length > 0 ? pct(sortedDays, 0.5) : null,
      p10DaysToPass:    sortedDays.length > 0 ? pct(sortedDays, 0.1) : null,
      p90DaysToPass:    sortedDays.length > 0 ? pct(sortedDays, 0.9) : null,
      fanData,
      rComparison,
      rSampleSize:      samples.length,
      riskInferenceNote,
      passProbCI:        uncertainty.passProbCI,
      mcStdErr:          uncertainty.mcStdErr,
      estimationStdErr:  uncertainty.estimationStdErr,
      bootstrapReps:     bootstrapProps.length,
      adequacy,
      resolvedThreshold: input.currentThreshold,
      resolvedPassLevel: input.startingEquity + input.profitTarget,
      planRulesApplied:  applyPlanRules,
      planRules:         accountPlanRules,
      planAccountSize:   accountPlanRules ? acctSize : null,
      planComparison,
    } satisfies EvalMonteCarloResponse)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
