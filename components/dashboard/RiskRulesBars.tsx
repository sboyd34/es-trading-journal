'use client'

import { useMemo } from 'react'
import { Trade, RiskRules } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'

interface RiskRulesBarsProps {
  todayTrades: Trade[]
  riskRules: RiskRules
}

interface RuleBarProps {
  label: string
  current: number
  max: number
  format?: (v: number) => string
}

function RuleBar({ label, current, max, format = String }: RuleBarProps) {
  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0
  const isOver80 = pct > 80
  const isOver50 = pct > 50

  const barColor = isOver80
    ? 'bg-red-500'
    : isOver50
    ? 'bg-yellow-500'
    : 'bg-emerald-500'

  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className={cn(
          'text-xs font-semibold',
          isOver80 ? 'text-red-400' : isOver50 ? 'text-yellow-400' : 'text-emerald-400'
        )}>
          {format(current)} / {format(max)}
        </span>
      </div>
      <div className="w-full h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-gray-600">0%</span>
        <span className={cn('text-[10px]', isOver80 ? 'text-red-400' : 'text-gray-600')}>
          {pct.toFixed(0)}% used
        </span>
      </div>
    </div>
  )
}

export default function RiskRulesBars({ todayTrades, riskRules }: RiskRulesBarsProps) {
  const { dailyLoss, tradeCount, consecutiveLosses } = useMemo(() => {
    const totalLoss = todayTrades.reduce((sum, t) => sum + t.net_pnl, 0)
    const currentDailyLoss = Math.max(-totalLoss, 0)

    const count = todayTrades.length

    // Count consecutive losses from most recent
    let streak = 0
    for (let i = todayTrades.length - 1; i >= 0; i--) {
      if (todayTrades[i].net_pnl < 0) {
        streak++
      } else {
        break
      }
    }

    return {
      dailyLoss: currentDailyLoss,
      tradeCount: count,
      consecutiveLosses: streak,
    }
  }, [todayTrades])

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Risk Rules</h3>

      <div className="space-y-5">
        <RuleBar
          label="Daily Loss Limit"
          current={dailyLoss}
          max={riskRules.max_daily_loss}
          format={formatCurrency}
        />
        <RuleBar
          label="Trades Today"
          current={tradeCount}
          max={riskRules.max_trades}
          format={(v) => `${v} trade${v !== 1 ? 's' : ''}`}
        />
        <RuleBar
          label="Consecutive Losses"
          current={consecutiveLosses}
          max={riskRules.max_consecutive_losses}
          format={(v) => `${v} loss${v !== 1 ? 'es' : ''}`}
        />
      </div>

      {/* Status indicator */}
      <div className={cn(
        'mt-4 px-3 py-2 rounded-lg text-xs font-medium',
        dailyLoss >= riskRules.max_daily_loss || tradeCount >= riskRules.max_trades || consecutiveLosses >= riskRules.max_consecutive_losses
          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
          : dailyLoss >= riskRules.max_daily_loss * 0.8 || tradeCount >= riskRules.max_trades * 0.8
          ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
      )}>
        {dailyLoss >= riskRules.max_daily_loss
          ? 'DAILY LOSS LIMIT HIT — Stop trading'
          : tradeCount >= riskRules.max_trades
          ? 'MAX TRADES REACHED — Stop trading'
          : consecutiveLosses >= riskRules.max_consecutive_losses
          ? 'CONSECUTIVE LOSS LIMIT — Take a break'
          : 'Risk rules OK — Trade with discipline'}
      </div>
    </div>
  )
}
