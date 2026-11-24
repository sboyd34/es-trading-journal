export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  bracketWhatIf,
  SWEEP_STOP_TICKS,
  SWEEP_TARGET_TICKS,
  type BracketTrade,
  type BracketWhatIf,
} from '@/lib/bracket-whatif'
import { feeForContracts } from '@/lib/tradovate-parser'

// Every grid cell is lib/bracket-whatif — the same engine as Plan Replay's
// what-if card, so the two can never disagree about a bracket. Every trade is
// 1 ES; outcomes are definite / likely / unknown and reported as a range.
//
// Replaces an older sweep that (a) only used trades with hand MAE/MFE,
// (b) compared the hand-entered MAE — stored NEGATIVE — with `mae >= stop`,
// so no stop ever registered, (c) measured in points (6–14 pt stops), and
// (d) ignored fees.

const GRADE_RANK: Record<string, number> = { A: 3, B: 2, C: 1, F: 0 }

type SweepTrade = BracketTrade & { grade: string | null; source: 'live' | 'backtest' }

export type ComboResult = BracketWhatIf & { liveCount: number; backtestCount: number }

export interface BracketSweepResponse {
  results: ComboResult[]
  totalIncluded: number
  liveCount: number
  backtestCount: number
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

    const cols = 'direction, entry_price, exit_price, mae, mfe, grade'
    const raw: SweepTrade[] = []

    for (const [table, src] of [['trades', 'live'], ['backtest_trades', 'backtest']] as const) {
      if ((src === 'live' && source === 'backtest') || (src === 'backtest' && source === 'live')) continue
      let q = supabase.from(table).select(cols).eq('user_id', user.id)
      if (dateFrom) q = q.gte('date', dateFrom)
      if (dateTo) q = q.lte('date', dateTo)
      if (setup) q = q.eq('setup_tag', setup)
      if (direction) q = q.eq('direction', direction)
      const { data } = await q
      for (const t of data ?? []) {
        raw.push({
          direction: t.direction,
          entry_price: Number(t.entry_price),
          exit_price: Number(t.exit_price),
          mae: t.mae != null ? Number(t.mae) : null,
          mfe: t.mfe != null ? Number(t.mfe) : null,
          grade: t.grade,
          source: src,
        })
      }
    }

    const included = minGrade
      ? raw.filter(t => t.grade != null && (GRADE_RANK[t.grade] ?? -1) >= (GRADE_RANK[minGrade] ?? 0))
      : raw
    const liveCount = included.filter(t => t.source === 'live').length
    const backtestCount = included.length - liveCount
    const fee = feeForContracts('ES', 1)

    const results: ComboResult[] = []
    for (const stop of SWEEP_STOP_TICKS) {
      for (const target of SWEEP_TARGET_TICKS) {
        results.push({ ...bracketWhatIf(included, stop, target, { fee }), liveCount, backtestCount })
      }
    }

    return NextResponse.json({
      results,
      totalIncluded: included.length,
      liveCount,
      backtestCount,
    } satisfies BracketSweepResponse)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
