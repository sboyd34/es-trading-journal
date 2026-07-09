export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const STOPS = [6, 8, 10, 12, 14]
const TARGETS = [10, 12, 15, 18, 20, 24]
const PT = 50 // $50/ES point — simulation unit

const GRADE_RANK: Record<string, number> = { A: 3, B: 2, C: 1, F: 0 }

interface RawTrade {
  mae: number | null
  mfe: number | null
  net_pnl: number
  grade: string | null
  source: 'live' | 'backtest'
}

export interface ComboResult {
  stop: number
  target: number
  tradeCount: number
  winCount: number
  lossCount: number
  unresolvedCount: number
  ambiguousCount: number
  winRate: number        // 0–100
  expectancy: number     // $ per trade
  totalPnL: number       // $
  maxConsecLosses: number
  profitFactor: number
  liveCount: number
  backtestCount: number
}

export interface BracketSweepResponse {
  results: ComboResult[]
  excludedCount: number
  totalIncluded: number
  liveCount: number
  backtestCount: number
}

function sweepCombo(
  trades: { mae: number; mfe: number; net_pnl: number; source: 'live' | 'backtest' }[],
  stop: number,
  target: number
): Omit<ComboResult, 'stop' | 'target'> {
  let winCount = 0
  let lossCount = 0
  let unresolvedCount = 0
  let ambiguousCount = 0
  let liveCount = 0
  let backtestCount = 0
  const pnls: number[] = []

  for (const t of trades) {
    if (t.source === 'live') liveCount++; else backtestCount++

    const stopHit = t.mae >= stop
    const targetHit = t.mfe >= target

    let simPnL: number
    if (stopHit && targetHit) {
      // Can't determine order from MAE/MFE alone — resolve conservatively as loss
      ambiguousCount++
      lossCount++
      simPnL = -(stop * PT)
    } else if (stopHit) {
      lossCount++
      simPnL = -(stop * PT)
    } else if (targetHit) {
      winCount++
      simPnL = target * PT
    } else {
      unresolvedCount++
      simPnL = t.net_pnl
    }
    pnls.push(simPnL)
  }

  const tradeCount = trades.length
  const totalPnL = pnls.reduce((s, p) => s + p, 0)
  const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0
  const expectancy = tradeCount > 0 ? totalPnL / tradeCount : 0
  const grossWins = pnls.filter(p => p > 0).reduce((s, p) => s + p, 0)
  const grossLosses = Math.abs(pnls.filter(p => p < 0).reduce((s, p) => s + p, 0))
  const profitFactor =
    grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0

  let maxConsecLosses = 0
  let streak = 0
  for (const p of pnls) {
    if (p < 0) { streak++; maxConsecLosses = Math.max(maxConsecLosses, streak) }
    else streak = 0
  }

  return {
    tradeCount, winCount, lossCount, unresolvedCount, ambiguousCount,
    winRate, expectancy, totalPnL, maxConsecLosses, profitFactor,
    liveCount, backtestCount,
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const {
      dateFrom,
      dateTo,
      setup,
      direction,
      minGrade,
      source = 'combined',
    } = body as {
      dateFrom?: string
      dateTo?: string
      setup?: string
      direction?: 'long' | 'short'
      minGrade?: 'A' | 'B' | 'C'
      source?: 'live' | 'backtest' | 'combined'
    }

    const raw: RawTrade[] = []

    if (source !== 'backtest') {
      let q = supabase
        .from('trades')
        .select('mae, mfe, net_pnl, grade')
        .eq('user_id', user.id)
      if (dateFrom) q = q.gte('date', dateFrom)
      if (dateTo) q = q.lte('date', dateTo)
      if (setup) q = q.eq('setup_tag', setup)
      if (direction) q = q.eq('direction', direction)
      const { data } = await q
      if (data) data.forEach(t =>
        raw.push({ mae: t.mae, mfe: t.mfe, net_pnl: t.net_pnl, grade: t.grade, source: 'live' })
      )
    }

    if (source !== 'live') {
      let q = supabase
        .from('backtest_trades')
        .select('mae, mfe, net_pnl, grade')
        .eq('user_id', user.id)
      if (dateFrom) q = q.gte('date', dateFrom)
      if (dateTo) q = q.lte('date', dateTo)
      if (setup) q = q.eq('setup_tag', setup)
      if (direction) q = q.eq('direction', direction)
      const { data } = await q
      if (data) data.forEach(t =>
        raw.push({ mae: t.mae, mfe: t.mfe, net_pnl: t.net_pnl, grade: t.grade, source: 'backtest' })
      )
    }

    const gradeFiltered = minGrade
      ? raw.filter(t => {
          if (!t.grade) return false
          return (GRADE_RANK[t.grade] ?? -1) >= (GRADE_RANK[minGrade] ?? 0)
        })
      : raw

    const valid = gradeFiltered.filter(
      (t): t is { mae: number; mfe: number; net_pnl: number; grade: string | null; source: 'live' | 'backtest' } =>
        t.mae != null && t.mfe != null
    )
    const excludedCount = gradeFiltered.length - valid.length
    const liveCount = valid.filter(t => t.source === 'live').length
    const backtestCount = valid.filter(t => t.source === 'backtest').length

    const results: ComboResult[] = []
    for (const stop of STOPS) {
      for (const target of TARGETS) {
        results.push({ stop, target, ...sweepCombo(valid, stop, target) })
      }
    }

    return NextResponse.json({
      results,
      excludedCount,
      totalIncluded: valid.length,
      liveCount,
      backtestCount,
    } satisfies BracketSweepResponse)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
