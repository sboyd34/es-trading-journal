'use client'

import { useMemo } from 'react'
import { Trade, RiskRules, DailySession, DashboardStats } from '@/types'
import StatsCards from '@/components/dashboard/StatsCards'
import EquityCurve from '@/components/dashboard/EquityCurve'
import WeekEquityCurve from '@/components/dashboard/WeekEquityCurve'
import PnLCalendar from '@/components/dashboard/PnLCalendar'
import SessionHeatmap from '@/components/dashboard/SessionHeatmap'
import EmotionBreakdown from '@/components/dashboard/EmotionBreakdown'
import TiltMeter from '@/components/dashboard/TiltMeter'
import RiskRulesBars from '@/components/dashboard/RiskRulesBars'

interface DashboardClientProps {
  trades: Trade[]
  todayTrades: Trade[]
  riskRules: RiskRules
  session: DailySession | null
}

function computeStats(trades: Trade[], todayTrades: Trade[]): DashboardStats {
  if (!trades.length) {
    return {
      totalPnL: 0,
      winRate: 0,
      totalTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      currentStreak: 0,
      todayPnL: todayTrades.reduce((s, t) => s + t.net_pnl, 0),
    }
  }

  const totalPnL = trades.reduce((s, t) => s + t.net_pnl, 0)
  const winners = trades.filter((t) => t.net_pnl > 0)
  const losers = trades.filter((t) => t.net_pnl <= 0)
  const winRate = (winners.length / trades.length) * 100
  const avgWin = winners.length ? winners.reduce((s, t) => s + t.net_pnl, 0) / winners.length : 0
  const avgLoss = losers.length ? Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0) / losers.length) : 0
  const grossWins = winners.reduce((s, t) => s + t.net_pnl, 0)
  const grossLosses = Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0))
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0
  const todayPnL = todayTrades.reduce((s, t) => s + t.net_pnl, 0)

  // Compute current streak (consecutive wins or losses from most recent)
  const sorted = [...trades].sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())
  let streak = 0
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1]
    const isWin = last.net_pnl > 0
    for (let i = sorted.length - 1; i >= 0; i--) {
      if ((sorted[i].net_pnl > 0) === isWin) {
        streak += isWin ? 1 : -1
      } else {
        break
      }
    }
  }

  return {
    totalPnL,
    winRate,
    totalTrades: trades.length,
    avgWin,
    avgLoss,
    profitFactor,
    currentStreak: streak,
    todayPnL,
  }
}

export default function DashboardClient({ trades, todayTrades, riskRules, session }: DashboardClientProps) {
  const stats = useMemo(() => computeStats(trades, todayTrades), [trades, todayTrades])

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-400 mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          {session?.checklist_passed && (
            <span className="ml-2 text-emerald-400 font-medium">✓ Checklist passed</span>
          )}
        </p>
      </div>

      {/* Stats cards */}
      <StatsCards stats={stats} todayPnL={stats.todayPnL} />

      {/* Equity curve full width */}
      <EquityCurve trades={trades} />

      {/* Middle row: calendar | heatmap | emotion */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <PnLCalendar trades={trades} />
        <SessionHeatmap trades={trades} />
        <EmotionBreakdown trades={trades} />
      </div>

      {/* Bottom row: week equity | tilt meter | risk rules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <WeekEquityCurve trades={trades} />
        <TiltMeter todayTrades={todayTrades} />
        <RiskRulesBars todayTrades={todayTrades} riskRules={riskRules} />
      </div>
    </div>
  )
}
