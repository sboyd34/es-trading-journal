'use client'

import { useMemo } from 'react'
import { Trade } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'
import { AlertOctagon } from 'lucide-react'

interface OffSystemDamageCardProps {
  trades: Trade[]
}

function inCurrentMonth(dateStr: string): boolean {
  const now = new Date()
  const [y, m] = dateStr.split('-').map(Number)
  return y === now.getFullYear() && m === now.getMonth() + 1
}

export default function OffSystemDamageCard({ trades }: OffSystemDamageCardProps) {
  const damage = useMemo(() => {
    const fTrades = trades.filter((t) => t.grade === 'F' && inCurrentMonth(t.date))
    if (fTrades.length === 0) return null

    const netPnL = fTrades.reduce((s, t) => s + t.net_pnl, 0)
    const sortedByLoss = [...fTrades].sort((a, b) => a.net_pnl - b.net_pnl)
    const biggestLoss = sortedByLoss[0]?.net_pnl ?? 0
    const sortedByTime = [...fTrades].sort(
      (a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime(),
    )
    const mostRecent = sortedByTime[0]

    return {
      count: fTrades.length,
      netPnL,
      biggestLoss,
      mostRecent,
    }
  }, [trades])

  if (!damage) return null

  return (
    <div className="bg-black/60 border border-gray-600 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertOctagon className="h-4 w-4 text-gray-300" />
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Off-system damage — month to date
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500">Trades</p>
          <p className="text-2xl font-bold text-white mt-0.5">{damage.count}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Net P&L</p>
          <p className={cn('text-2xl font-bold mt-0.5', damage.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {formatCurrency(damage.netPnL)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Biggest loss</p>
          <p className="text-2xl font-bold text-red-400 mt-0.5">{formatCurrency(damage.biggestLoss)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Most recent</p>
          <p className="text-sm text-gray-200 mt-1.5">
            {new Date(damage.mostRecent.entry_time).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
            <span className="text-gray-500"> · </span>
            <span className="text-gray-400">{damage.mostRecent.instrument}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
