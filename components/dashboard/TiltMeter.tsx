'use client'

import { useMemo } from 'react'
import { Trade } from '@/types'
import { cn } from '@/lib/utils'

interface TiltMeterProps {
  todayTrades: Trade[]
}

interface TiltFactor {
  label: string
  points: number
  triggered: boolean
}

export default function TiltMeter({ todayTrades }: TiltMeterProps) {
  const { score, factors, level, label, color } = useMemo(() => {
    const factors: TiltFactor[] = []
    let score = 0

    // Factor 1: Last 3 trades all losers
    if (todayTrades.length >= 3) {
      const last3 = todayTrades.slice(-3)
      const allLosers = last3.every((t) => t.net_pnl < 0)
      factors.push({
        label: 'Last 3 trades all losers',
        points: 40,
        triggered: allLosers,
      })
      if (allLosers) score += 40
    } else {
      factors.push({
        label: 'Last 3 trades all losers',
        points: 40,
        triggered: false,
      })
    }

    // Factor 2: Revenge/FOMO trades
    const revengeTrades = todayTrades.filter((t) => t.mood === 'revenge')
    const fomoTrades = todayTrades.filter((t) => t.mood === 'FOMO')
    const emotionCount = revengeTrades.length + fomoTrades.length
    const emotionPoints = emotionCount * 30
    factors.push({
      label: `Revenge/FOMO mood (${emotionCount} trade${emotionCount !== 1 ? 's' : ''})`,
      points: emotionPoints,
      triggered: emotionCount > 0,
    })
    score += emotionPoints

    // Factor 3: Net P&L today < -$200
    const todayPnL = todayTrades.reduce((sum, t) => sum + t.net_pnl, 0)
    const pnlTriggered = todayPnL < -200
    factors.push({
      label: `Today P&L < -$200 (${todayPnL < 0 ? '-' : '+'}$${Math.abs(Math.round(todayPnL))})`,
      points: 20,
      triggered: pnlTriggered,
    })
    if (pnlTriggered) score += 20

    // Factor 4: More than 4 trades today
    const manyTrades = todayTrades.length > 4
    factors.push({
      label: `More than 4 trades today (${todayTrades.length})`,
      points: 10,
      triggered: manyTrades,
    })
    if (manyTrades) score += 10

    const cappedScore = Math.min(score, 100)

    let level: 'safe' | 'warning' | 'danger'
    let label: string
    let color: string

    if (cappedScore < 30) {
      level = 'safe'
      label = 'In Control'
      color = 'bg-emerald-500'
    } else if (cappedScore < 60) {
      level = 'warning'
      label = 'Watch Yourself'
      color = 'bg-yellow-500'
    } else {
      level = 'danger'
      label = 'STOP TRADING'
      color = 'bg-red-500'
    }

    return { score: cappedScore, factors, level, label, color }
  }, [todayTrades])

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Tilt Meter</h3>

      {/* Score and label */}
      <div className="flex items-center justify-between mb-3">
        <span className={cn(
          'text-sm font-bold px-3 py-1 rounded-full',
          level === 'safe' && 'bg-emerald-500/20 text-emerald-400',
          level === 'warning' && 'bg-yellow-500/20 text-yellow-400',
          level === 'danger' && 'bg-red-500/20 text-red-400 animate-pulse',
        )}>
          {label}
        </span>
        <span className="text-2xl font-bold text-white">{score}</span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-4 bg-gray-700 rounded-full overflow-hidden mb-2">
        <div
          className={cn('h-full rounded-full transition-all duration-700', color)}
          style={{ width: `${score}%` }}
        />
      </div>

      {/* Zone labels */}
      <div className="flex justify-between text-[10px] text-gray-500 mb-4">
        <span>0 — In Control</span>
        <span>30 — Watch Out</span>
        <span>60 — Stop</span>
        <span>100</span>
      </div>

      {/* Factors */}
      <div className="space-y-2">
        <p className="text-xs text-gray-400 font-medium">Contributing Factors:</p>
        {factors.map((factor, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                'w-1.5 h-1.5 rounded-full',
                factor.triggered ? 'bg-red-400' : 'bg-gray-600'
              )} />
              <span className={cn(
                'text-xs',
                factor.triggered ? 'text-gray-200' : 'text-gray-500'
              )}>
                {factor.label}
              </span>
            </div>
            <span className={cn(
              'text-xs font-medium',
              factor.triggered ? 'text-red-400' : 'text-gray-600'
            )}>
              {factor.triggered ? `+${factor.points}` : '+0'}
            </span>
          </div>
        ))}
      </div>

      {todayTrades.length === 0 && (
        <p className="text-xs text-gray-500 mt-3">No trades today — you&apos;re fresh!</p>
      )}
    </div>
  )
}
