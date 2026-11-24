'use client'

import { useMemo } from 'react'
import { Trade } from '@/types'
import { cn } from '@/lib/utils'
import { Target } from 'lucide-react'

// TP1 / TP2 hit rates from the trade form's "First contract hit TP?" and
// "Second contract hit TP?" answers. Only recorded answers count (null =
// not recorded), so unanswered trades never read as misses. TP2 is asked only
// after a TP1 Yes, so its rate is conditional: of the trades whose leg 1 hit,
// how often leg 2 reached its target instead of the breakeven stop.
// Silent until at least one TP1 answer exists; the TP2 half until one TP2 does.

interface Props {
  trades: Trade[]
}

function rateColor(rate: number): string {
  if (rate >= 60) return 'text-emerald-400'
  if (rate >= 40) return 'text-amber-400'
  return 'text-red-400'
}

function barColor(rate: number): string {
  if (rate >= 60) return 'bg-emerald-500'
  if (rate >= 40) return 'bg-amber-500'
  return 'bg-red-500'
}

export default function TargetHitRateCard({ trades }: Props) {
  const stats = useMemo(() => {
    const tp1 = trades.filter((t) => t.first_target_hit !== null && t.first_target_hit !== undefined)
    const tp1Hits = tp1.filter((t) => t.first_target_hit === true).length
    const tp2 = trades.filter((t) => t.first_target_hit === true && t.second_target_hit !== null && t.second_target_hit !== undefined)
    const tp2Hits = tp2.filter((t) => t.second_target_hit === true).length
    return {
      tp1Total: tp1.length,
      tp1Hits,
      tp1Rate: tp1.length ? (100 * tp1Hits) / tp1.length : 0,
      tp2Total: tp2.length,
      tp2Hits,
      tp2Rate: tp2.length ? (100 * tp2Hits) / tp2.length : 0,
      awaitingTp2: trades.filter((t) => t.first_target_hit === true && (t.second_target_hit === null || t.second_target_hit === undefined)).length,
      unrecorded: trades.length - tp1.length,
    }
  }, [trades])

  if (stats.tp1Total === 0) return null

  const Row = ({ label, sub, hits, total, rate }: { label: string; sub: string; hits: number; total: number; rate: number }) => (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-300">{label}</p>
          <p className="text-[11px] text-gray-500">{sub}</p>
        </div>
        <div className="text-right">
          <p className={cn('text-2xl font-bold tabular-nums', rateColor(rate))}>{rate.toFixed(0)}%</p>
          <p className="text-[11px] text-gray-500 tabular-nums">{hits} of {total}</p>
        </div>
      </div>
      <div className="mt-2 h-2 w-full bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', barColor(rate))} style={{ width: `${rate}%` }} />
      </div>
    </div>
  )

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Target className="h-4 w-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-200">Target Hit Rate</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Row label="TP1 — first contract" sub="of trades with an answer" hits={stats.tp1Hits} total={stats.tp1Total} rate={stats.tp1Rate} />
        {stats.tp2Total > 0 && (
          <Row label="TP2 — second contract" sub="of trades where TP1 hit" hits={stats.tp2Hits} total={stats.tp2Total} rate={stats.tp2Rate} />
        )}
      </div>

      {(stats.unrecorded > 0 || stats.awaitingTp2 > 0) && (
        <p className="mt-4 text-[11px] text-gray-500">
          {stats.unrecorded > 0 && `${stats.unrecorded} trade${stats.unrecorded !== 1 ? 's' : ''} without a TP1 answer. `}
          {stats.awaitingTp2 > 0 && `${stats.awaitingTp2} TP1 hit${stats.awaitingTp2 !== 1 ? 's' : ''} still need${stats.awaitingTp2 === 1 ? 's' : ''} a TP2 answer.`}
        </p>
      )}
    </div>
  )
}
