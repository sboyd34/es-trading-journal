'use client'

import { DashboardStats } from '@/types'
import { formatCurrency, getPnLColor, cn } from '@/lib/utils'
import { EodGateCard } from '@/components/ui/EodGateCard'

interface StatsCardsProps {
  stats: DashboardStats
  todayPnL: number
  todayGrossPnL: number
  gateActive?: boolean
}

interface StatCardProps {
  label: string
  value: string
  valueColor?: string
  subtext?: string
}

function StatCard({ label, value, valueColor, subtext }: StatCardProps) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700/50">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={cn('text-2xl font-bold mt-1', valueColor || 'text-white')}>{value}</p>
      {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
    </div>
  )
}

export default function StatsCards({ stats, todayPnL, todayGrossPnL, gateActive = false }: StatsCardsProps) {
  const streakLabel = stats.currentStreak >= 0
    ? `${stats.currentStreak}W streak`
    : `${Math.abs(stats.currentStreak)}L streak`
  const streakColor = stats.currentStreak >= 0 ? 'text-emerald-400' : 'text-red-400'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      <StatCard
        label="Total P&L"
        value={formatCurrency(stats.totalPnL)}
        valueColor={getPnLColor(stats.totalPnL)}
        subtext={`Gross ${formatCurrency(stats.totalGrossPnL)}`}
      />
      {gateActive ? (
        <EodGateCard label="Today's P&L" />
      ) : (
        <StatCard
          label="Today's P&L"
          value={formatCurrency(todayPnL)}
          valueColor={getPnLColor(todayPnL)}
          subtext={`Gross ${formatCurrency(todayGrossPnL)}`}
        />
      )}
      <StatCard
        label="Win Rate"
        value={`${stats.winRate.toFixed(1)}%`}
        valueColor={stats.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400'}
        subtext={`${stats.totalTrades} trades`}
      />
      <StatCard
        label="Total Trades"
        value={stats.totalTrades.toString()}
        subtext="All time"
      />
      <StatCard
        label="Profit Factor"
        value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
        valueColor={stats.profitFactor >= 1.5 ? 'text-emerald-400' : stats.profitFactor >= 1 ? 'text-yellow-400' : 'text-red-400'}
        subtext={`Avg W: ${formatCurrency(stats.avgWin)}`}
      />
      <StatCard
        label="Streak"
        value={stats.currentStreak === 0 ? '—' : streakLabel}
        valueColor={streakColor}
        subtext={`Avg L: ${formatCurrency(Math.abs(stats.avgLoss))}`}
      />
    </div>
  )
}
