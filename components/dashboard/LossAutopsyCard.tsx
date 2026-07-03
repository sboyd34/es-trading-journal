'use client'

import { useMemo } from 'react'
import { Trade } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'
import { Activity } from 'lucide-react'

interface LossAutopsyCardProps {
  trades: Trade[]
}

export default function LossAutopsyCard({ trades }: LossAutopsyCardProps) {
  const autopsy = useMemo(() => {
    // loss_type is only set on enriched losing trades.
    const losses = trades.filter((t) => t.loss_type != null)
    if (losses.length === 0) return null

    const reversal = losses.filter((t) => t.loss_type === 'reversal_loss')
    const straight = losses.filter((t) => t.loss_type === 'straight_loss')

    const reversalPnL = reversal.reduce((s, t) => s + t.net_pnl, 0)
    const straightPnL = straight.reduce((s, t) => s + t.net_pnl, 0)

    // How far green the reversal losses ran before turning red — the discipline leak, in ticks.
    const avgGreenGivenUp = reversal.length
      ? reversal.reduce((s, t) => s + (t.mfe_ticks ?? 0), 0) / reversal.length
      : 0

    return {
      total: losses.length,
      reversalCount: reversal.length,
      straightCount: straight.length,
      reversalPnL,
      straightPnL,
      avgGreenGivenUp,
    }
  }, [trades])

  if (!autopsy) return null

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-gray-300" />
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Loss autopsy
        </p>
        <span className="text-xs text-gray-600">· {autopsy.total} classified</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500">Reversal losses</p>
          <p className="text-2xl font-bold text-amber-400 mt-0.5">{autopsy.reversalCount}</p>
          <p className="text-xs text-gray-600 mt-0.5">ran green, gave it back</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Straight losses</p>
          <p className="text-2xl font-bold text-gray-200 mt-0.5">{autopsy.straightCount}</p>
          <p className="text-xs text-gray-600 mt-0.5">wrong from entry</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Avg green given up</p>
          <p className="text-2xl font-bold text-amber-400 mt-0.5">
            {autopsy.avgGreenGivenUp.toFixed(1)}<span className="text-sm text-gray-500">t</span>
          </p>
          <p className="text-xs text-gray-600 mt-0.5">on reversal losses</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Reversal $ lost</p>
          <p className={cn('text-2xl font-bold mt-0.5', autopsy.reversalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {formatCurrency(autopsy.reversalPnL)}
          </p>
          <p className="text-xs text-gray-600 mt-0.5">avoidable damage</p>
        </div>
      </div>
    </div>
  )
}
