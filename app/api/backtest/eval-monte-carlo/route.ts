export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const POINT_VALUES: Record<string, number> = { ES: 50, MES: 5, NQ: 20, MNQ: 2 }
const COMPARISON_RISKS = [250, 500, 750, 1000]
// Sampled trading days for the fan chart (25 checkpoints over 120 days)
const FAN_DAYS = [
  0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
  65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120,
]

interface RSample {
  r: number
  mfePts: number | null
  stopPts: number | null
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
  source: 'live' | 'combined'
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
  source: 'live' | 'combined'
  combinedCaveat: boolean
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
  } = input

  const passLevel = startingEquity + profitTarget
  // FREEZE RULE: The Apex trailing threshold stops trailing once it reaches
  // startingEquity + 100. Verify this freeze level against the current Apex Trader
  // Funding evaluation agreement before relying on it — Apex has revised trailing
  // rules in the past.
  const freezeThreshold = startingEquity + 100
  const maxTrades = Math.ceil(120 * tradesPerDay)
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

  for (let sim = 0; sim < numSimulations; sim++) {
    let equity = currentEquity
    let equityHwm = currentEquity
    let threshold = currentThreshold

    let outcome: 'pass' | 'fail' | 'timeout' = 'timeout'
    let endTradeIdx = maxTrades

    // Record day-0 equity
    if (collectFan) {
      const idx0 = fanCheckpointMap.get(0)
      if (idx0 !== undefined) fanEquities[idx0].push(equity)
    }

    for (let tradeIdx = 1; tradeIdx <= maxTrades; tradeIdx++) {
      const s = samples[Math.floor(Math.random() * n)]

      // Intra-trade MFE ratchet for winning trades (Apex trails on unrealized peaks)
      if (s.r > 0 && s.mfePts !== null && s.stopPts !== null && s.stopPts > 0) {
        const mfeR = s.mfePts / s.stopPts
        const intraPeak = equity + mfeR * riskPerTrade
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

      if (collectFan) {
        const fanIdx = fanCheckpointMap.get(tradeIdx)
        if (fanIdx !== undefined) fanEquities[fanIdx].push(equity)
      }
    }

    // Fill remaining fan checkpoints with terminal equity for early-exit sims
    if (collectFan && outcome !== 'timeout') {
      FAN_DAYS.forEach((day, i) => {
        const checkpointTrade = Math.round(day * tradesPerDay)
        if (checkpointTrade > endTradeIdx) {
          fanEquities[i].push(equity)
        }
      })
    }

    if (outcome === 'pass') {
      passCount++
      daysToPass.push(Math.ceil(endTradeIdx / tradesPerDay))
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const input: EvalSimInput = {
      startingEquity:   body.startingEquity   ?? 250_000,
      profitTarget:     body.profitTarget      ?? 15_000,
      trailingDrawdown: body.trailingDrawdown  ?? 6_500,
      riskPerTrade:     body.riskPerTrade      ?? 500,
      tradesPerDay:     body.tradesPerDay      ?? 2.5,
      currentEquity:    body.currentEquity     ?? 251_636.10,
      currentThreshold: body.currentThreshold  ?? 245_136.10,
      numSimulations:   Math.min(body.numSimulations ?? 10_000, 20_000),
      source:           body.source === 'combined' ? 'combined' : 'live',
    }

    // Fetch live trades
    const { data: liveTrades } = await supabase
      .from('trades')
      .select('net_pnl, entry_price, stop_loss, quantity, instrument, mfe')
      .eq('user_id', user.id)

    type RawRow = {
      net_pnl: number
      entry_price: number
      stop_loss: number | null
      quantity: number
      instrument: string
      mfe: number | null
    }

    const rawTrades: RawRow[] = [...(liveTrades ?? [])] as RawRow[]

    if (input.source === 'combined') {
      const { data: btTrades } = await supabase
        .from('backtest_trades')
        .select('net_pnl, entry_price, stop_loss, quantity, instrument, mfe')
        .eq('user_id', user.id)
      ;(btTrades ?? []).forEach(t => rawTrades.push(t as RawRow))
    }

    let stopCount = 0
    let fallbackCount = 0

    const samples: RSample[] = rawTrades
      .filter(t => t.net_pnl != null && t.entry_price != null)
      .map(t => {
        const pv = POINT_VALUES[t.instrument ?? 'ES'] ?? 50
        let riskDollars: number
        let stopPts: number | null = null

        if (t.stop_loss != null) {
          stopPts = Math.abs(t.entry_price - t.stop_loss)
          riskDollars = stopPts * pv * (t.quantity ?? 1)
          if (riskDollars > 0) {
            stopCount++
          } else {
            riskDollars = input.riskPerTrade
            stopPts = null
            fallbackCount++
          }
        } else {
          riskDollars = input.riskPerTrade
          fallbackCount++
        }

        const r = t.net_pnl / riskDollars
        const mfePts = t.mfe != null && stopPts != null ? t.mfe : null

        return { r, mfePts, stopPts }
      })

    if (samples.length < 5) {
      return NextResponse.json(
        { error: 'Need at least 5 trades with P&L to build R distribution' },
        { status: 400 }
      )
    }

    const riskInferenceNote =
      fallbackCount === 0
        ? `Risk inferred from stop distance for all ${samples.length} trades.`
        : stopCount === 0
        ? `No stop_loss data found — all ${samples.length} trades assumed $${input.riskPerTrade} risk.`
        : `Risk from stop distance: ${stopCount} trade${stopCount !== 1 ? 's' : ''}. Fallback $${input.riskPerTrade} assumed: ${fallbackCount} trade${fallbackCount !== 1 ? 's' : ''}.`

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
      source:           input.source,
      combinedCaveat:   input.source === 'combined',
    } satisfies EvalMonteCarloResponse)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
