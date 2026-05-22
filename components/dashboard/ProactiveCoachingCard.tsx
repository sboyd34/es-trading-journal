'use client'

import { useMemo } from 'react'
import { Trade, RiskRules } from '@/types'
import { cn, formatCurrency } from '@/lib/utils'
import { parseISO, subDays } from 'date-fns'
import { ShieldAlert, AlertTriangle, TrendingDown, Brain, CheckCircle2, Zap } from 'lucide-react'

interface CoachingSignal {
  id: string
  severity: 'critical' | 'warning' | 'positive'
  icon: React.ReactNode
  title: string
  detail: string
}

interface Props {
  trades: Trade[]
  todayTrades: Trade[]
  riskRules: RiskRules
}

const EMOTIONAL_MOODS = new Set(['FOMO', 'revenge', 'anxious', 'overconfident'])

// Soft stop ≈ 60% of hard stop (matches Apex eval 150/250 ratio).
const SOFT_STOP_RATIO = 0.6

export default function ProactiveCoachingCard({ trades, todayTrades, riskRules }: Props) {
  const signals = useMemo<CoachingSignal[]>(() => {
    const result: CoachingSignal[] = []
    const todayPnL = todayTrades.reduce((s, t) => s + t.net_pnl, 0)
    const dailyLoss = Math.max(-todayPnL, 0)
    const softStop = riskRules.max_daily_loss * SOFT_STOP_RATIO
    const hardStop = riskRules.max_daily_loss

    // ── Apex drawdown ─────────────────────────────────────────────────────────
    if (dailyLoss >= hardStop) {
      result.push({
        id: 'apex-hard-stop',
        severity: 'critical',
        icon: <ShieldAlert className="h-4 w-4 flex-shrink-0" />,
        title: 'Hard stop reached — session is over',
        detail: `Down ${formatCurrency(dailyLoss)} today. Hard stop is ${formatCurrency(hardStop)}. Close the platform now.`,
      })
    } else if (dailyLoss >= softStop) {
      const remaining = hardStop - dailyLoss
      result.push({
        id: 'apex-soft-stop',
        severity: 'critical',
        icon: <AlertTriangle className="h-4 w-4 flex-shrink-0" />,
        title: 'Soft stop breached — trade half base size',
        detail: `Down ${formatCurrency(dailyLoss)}. ${formatCurrency(remaining)} left to hard stop. Reduce to half size for any remaining trades.`,
      })
    } else if (dailyLoss >= softStop * 0.7 && dailyLoss > 0) {
      result.push({
        id: 'apex-approaching',
        severity: 'warning',
        icon: <AlertTriangle className="h-4 w-4 flex-shrink-0" />,
        title: 'Approaching soft stop',
        detail: `Down ${formatCurrency(dailyLoss)} — soft stop is ${formatCurrency(softStop)}. ${formatCurrency(softStop - dailyLoss)} remaining before size reduction kicks in.`,
      })
    }

    // ── Daily trade count ────────────────────────────────────────────────────
    if (todayTrades.length >= riskRules.max_trades) {
      result.push({
        id: 'apex-trade-count',
        severity: 'critical',
        icon: <ShieldAlert className="h-4 w-4 flex-shrink-0" />,
        title: `Max trades reached (${todayTrades.length}/${riskRules.max_trades}) — session closed`,
        detail: 'You have hit your Apex daily trade limit. No more entries today, regardless of setup quality.',
      })
    }

    // ── Consecutive loss streak (across recent trades, not just today) ────────
    const recents = [...trades]
      .sort((a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime())
      .slice(0, 20)
    let lossStreak = 0
    for (const t of recents) {
      if (t.net_pnl < 0) lossStreak++
      else break
    }
    if (lossStreak >= 4) {
      result.push({
        id: 'loss-streak-critical',
        severity: 'critical',
        icon: <TrendingDown className="h-4 w-4 flex-shrink-0" />,
        title: `${lossStreak} consecutive losers — pattern break`,
        detail: 'Four or more losses in a row is a signal to stop and reassess bias. Is the 1H still aligned? Are you chasing or tilting?',
      })
    } else if (lossStreak === 3) {
      result.push({
        id: 'loss-streak-warning',
        severity: 'warning',
        icon: <TrendingDown className="h-4 w-4 flex-shrink-0" />,
        title: '3 consecutive losers — pause and verify',
        detail: 'Three in a row. Step back before the next entry. Verify 1H bias is still valid and you\'re at an approved location.',
      })
    }

    // ── 7-day emotional trade rate ────────────────────────────────────────────
    const cutoff7 = subDays(new Date(), 7)
    const last7 = trades.filter((t) => parseISO(t.date) >= cutoff7)
    const emotionalThis = last7.filter((t) => EMOTIONAL_MOODS.has(t.mood ?? ''))
    const emotionalRate = last7.length >= 5 ? emotionalThis.length / last7.length : 0
    if (emotionalRate >= 0.3) {
      result.push({
        id: 'emotional-trend',
        severity: 'warning',
        icon: <Brain className="h-4 w-4 flex-shrink-0" />,
        title: `${Math.round(emotionalRate * 100)}% emotional trades this week`,
        detail: `${emotionalThis.length} of ${last7.length} trades tagged FOMO, revenge, anxious, or overconfident. Run the pre-trade checklist strictly before every entry.`,
      })
    }

    // ── C-grade rate this week vs prior week ─────────────────────────────────
    const cutoff14 = subDays(new Date(), 14)
    const prior7 = trades.filter(
      (t) => parseISO(t.date) >= cutoff14 && parseISO(t.date) < cutoff7,
    )
    const cThis = last7.filter((t) => t.grade === 'C').length
    const cPrior = prior7.filter((t) => t.grade === 'C').length
    const cRateThis = last7.length >= 5 ? cThis / last7.length : 0
    const cRatePrior = prior7.length > 0 ? cPrior / prior7.length : 0
    if (cRateThis >= 0.3) {
      const increasing = cRateThis > cRatePrior + 0.1
      result.push({
        id: 'c-grade-cluster',
        severity: increasing ? 'warning' : 'warning',
        icon: <AlertTriangle className="h-4 w-4 flex-shrink-0" />,
        title: `C-grade rate ${Math.round(cRateThis * 100)}% this week${increasing ? ' — rising' : ''}`,
        detail: `${cThis} C-grades in last 7 days${prior7.length > 0 ? ` vs ${cPrior} the prior 7` : ''}. Something in your execution is drifting — review the grade rubric.`,
      })
    }

    // ── Positive: winning streak ──────────────────────────────────────────────
    let winStreak = 0
    for (const t of recents) {
      if (t.net_pnl > 0) winStreak++
      else break
    }
    if (winStreak >= 3 && lossStreak === 0 && dailyLoss < softStop * 0.5) {
      result.push({
        id: 'win-streak',
        severity: 'positive',
        icon: <CheckCircle2 className="h-4 w-4 flex-shrink-0" />,
        title: `${winStreak}-trade winning streak — stay selective`,
        detail: 'You\'re executing well. Don\'t chase or force setups. Keep waiting for A-grade confluences only.',
      })
    }

    // Sort: critical → warning → positive
    const order: Record<string, number> = { critical: 0, warning: 1, positive: 2 }
    return result.sort((a, b) => order[a.severity] - order[b.severity])
  }, [trades, todayTrades, riskRules])

  if (signals.length === 0) return null

  const criticalCount = signals.filter((s) => s.severity === 'critical').length
  const warningCount = signals.filter((s) => s.severity === 'warning').length

  const headerColor = criticalCount > 0
    ? 'border-red-500/40 bg-red-500/5'
    : warningCount > 0
    ? 'border-amber-500/40 bg-amber-500/5'
    : 'border-emerald-500/40 bg-emerald-500/5'

  const headerTextColor = criticalCount > 0
    ? 'text-red-400'
    : warningCount > 0
    ? 'text-amber-400'
    : 'text-emerald-400'

  const severityStyle: Record<CoachingSignal['severity'], string> = {
    critical: 'border-red-500/30 bg-red-500/5 text-red-400',
    warning: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    positive: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
  }

  const severityDetailColor: Record<CoachingSignal['severity'], string> = {
    critical: 'text-red-300/80',
    warning: 'text-amber-300/80',
    positive: 'text-emerald-300/80',
  }

  return (
    <div className={cn('border rounded-xl overflow-hidden', headerColor)}>
      {/* Header */}
      <div className={cn('flex items-center gap-2.5 px-4 py-3 border-b border-gray-700/40')}>
        <Zap className={cn('h-4 w-4', headerTextColor)} />
        <span className={cn('text-sm font-semibold', headerTextColor)}>Coaching Inbox</span>
        <div className="flex gap-1.5 ml-1">
          {criticalCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">
              {criticalCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
              {warningCount} warning
            </span>
          )}
        </div>
        <span className="ml-auto text-[11px] text-gray-600">auto-updates on each session open</span>
      </div>

      {/* Signal list */}
      <div className="divide-y divide-gray-700/30">
        {signals.map((signal) => (
          <div key={signal.id} className="flex items-start gap-3 px-4 py-3.5">
            <span className={cn('mt-0.5', severityStyle[signal.severity].split(' ')[2])}>
              {signal.icon}
            </span>
            <div className="min-w-0">
              <p className={cn('text-sm font-semibold leading-snug', severityStyle[signal.severity].split(' ')[2])}>
                {signal.title}
              </p>
              <p className={cn('text-xs mt-0.5 leading-relaxed', severityDetailColor[signal.severity])}>
                {signal.detail}
              </p>
            </div>
            <span className={cn(
              'mt-0.5 flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border',
              signal.severity === 'critical' && 'border-red-500/30 bg-red-500/10 text-red-500',
              signal.severity === 'warning' && 'border-amber-500/30 bg-amber-500/10 text-amber-500',
              signal.severity === 'positive' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
            )}>
              {signal.severity}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
