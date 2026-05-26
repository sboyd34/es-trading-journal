'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { Trade, RiskRules, DailySession, DashboardStats } from '@/types'
import { isSystemTrade } from '@/lib/trade-flags'
import StatsCards from '@/components/dashboard/StatsCards'
import EquityCurve from '@/components/dashboard/EquityCurve'
import WeekEquityCurve from '@/components/dashboard/WeekEquityCurve'
import PnLCalendar from '@/components/dashboard/PnLCalendar'
import SessionHeatmap from '@/components/dashboard/SessionHeatmap'
import EmotionBreakdown from '@/components/dashboard/EmotionBreakdown'
import TiltMeter from '@/components/dashboard/TiltMeter'
import RiskRulesBars from '@/components/dashboard/RiskRulesBars'
import SessionTimer from '@/components/dashboard/SessionTimer'
import SessionCloseNotifier from '@/components/dashboard/SessionCloseNotifier'
import TradovateSyncBadge from '@/components/dashboard/TradovateSyncBadge'
import TradingWindowIndicator from '@/components/dashboard/TradingWindowIndicator'
import MarketNewsFeed from '@/components/dashboard/MarketNewsFeed'
import ProactiveCoachingCard from '@/components/dashboard/ProactiveCoachingCard'
import OffSystemDamageCard from '@/components/dashboard/OffSystemDamageCard'
import DisciplineScoreCard from '@/components/dashboard/DisciplineScoreCard'
import MarketStateCard from '@/components/market/MarketStateCard'
import { isGateActive } from '@/lib/eod-gate'
import PreSessionBanner from '@/components/dashboard/PreSessionBanner'

interface DashboardClientProps {
  trades: Trade[]
  todayTrades: Trade[]
  riskRules: RiskRules
  session: DailySession | null
  userId: string
  date: string
}

function computeStats(trades: Trade[], todayTrades: Trade[]): DashboardStats {
  // "System" trades drive win rate, expectancy, streak — F trades are excluded.
  // Raw P&L still includes everything because the money was real.
  const systemTrades = trades.filter(isSystemTrade)
  const todayPnL = todayTrades.reduce((s, t) => s + t.net_pnl, 0)
  const todayGrossPnL = todayTrades.reduce((s, t) => s + t.gross_pnl, 0)

  if (!trades.length) {
    return {
      totalPnL: 0,
      totalGrossPnL: 0,
      winRate: 0,
      totalTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      currentStreak: 0,
      todayPnL,
      todayGrossPnL,
    }
  }

  const totalPnL = trades.reduce((s, t) => s + t.net_pnl, 0)
  const totalGrossPnL = trades.reduce((s, t) => s + t.gross_pnl, 0)

  const winners = systemTrades.filter((t) => t.net_pnl > 0)
  const losers = systemTrades.filter((t) => t.net_pnl <= 0)
  const winRate = systemTrades.length ? (winners.length / systemTrades.length) * 100 : 0
  const avgWin = winners.length ? winners.reduce((s, t) => s + t.net_pnl, 0) / winners.length : 0
  const avgLoss = losers.length ? Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0) / losers.length) : 0
  const grossWins = winners.reduce((s, t) => s + t.net_pnl, 0)
  const grossLosses = Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0))
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0

  // Streak runs over system trades only — an off-system loss shouldn't break a winning streak.
  const sorted = [...systemTrades].sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())
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
    totalGrossPnL,
    winRate,
    totalTrades: systemTrades.length,
    avgWin,
    avgLoss,
    profitFactor,
    currentStreak: streak,
    todayPnL,
    todayGrossPnL,
  }
}

export default function DashboardClient({ trades, todayTrades, riskRules, session, userId, date }: DashboardClientProps) {
  const stats = useMemo(() => computeStats(trades, todayTrades), [trades, todayTrades])
  const gateActive = useMemo(
    () => isGateActive(new Date(), todayTrades, session),
    [todayTrades, session],
  )
  const [postLossDay, setPostLossDay] = useState(false)
  const [macroEventDetected, setMacroEventDetected] = useState(false)

  useEffect(() => {
    setPostLossDay(localStorage.getItem('post_loss_day') === 'true')
  }, [])

  const handleMacroEvent = useCallback((detected: boolean) => {
    setMacroEventDetected(detected)
  }, [])

  return (
    <div className="space-y-6">
      <p className="text-center text-sm italic text-gray-500 tracking-wide">
        I am a disciplined, patient and objective trader.
      </p>
      <SessionCloseNotifier />

      {/* Post-loss day banner */}
      {postLossDay && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3">
          <span className="text-amber-400 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-300">Post-loss day — half base size today</p>
            <p className="text-xs text-amber-400/70 mt-0.5">Automatically trade reduced size this session. Reset in Settings when ready.</p>
          </div>
        </div>
      )}

      {/* Proactive coaching — only renders when signals are present */}
      <ProactiveCoachingCard trades={trades} todayTrades={todayTrades} riskRules={riskRules} />

      {/* Auto-pulled SPY market state */}
      <MarketStateCard />

      {/* Trading window indicator */}
      <TradingWindowIndicator macroEventDetected={macroEventDetected} />

      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            {session?.checklist_passed && (
              <span className="ml-2 text-emerald-400 font-medium">✓ Checklist passed</span>
            )}
          </p>
        </div>
        <TradovateSyncBadge />
      </div>

      {/* Stats cards */}
      <PreSessionBanner session={session} />

      {/* Stats cards */}
      <StatsCards stats={stats} todayPnL={stats.todayPnL} todayGrossPnL={stats.todayGrossPnL} gateActive={gateActive} />

      {/* Off-system damage — silent when there are no F trades this month */}
      <OffSystemDamageCard trades={trades} />

      {/* Discipline score — silent when no trades today */}
      <DisciplineScoreCard
        trades={todayTrades}
        session={session}
        userId={userId}
        date={date}
      />

      {/* Session timer */}
      <SessionTimer todayTrades={todayTrades} />

      {/* Equity curve full width */}
      <EquityCurve trades={trades} />

      {/* Market news feed */}
      <MarketNewsFeed onMacroEvent={handleMacroEvent} />

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
