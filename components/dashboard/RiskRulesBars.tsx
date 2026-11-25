'use client'

import { useMemo } from 'react'
import { Trade, RiskRules, ApexAccount } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'
import { accountRiskGroups, accountRiskUsage } from '@/lib/account-risk'

interface RiskRulesBarsProps {
  todayTrades: Trade[]
  accounts: ApexAccount[]
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

export default function RiskRulesBars({ todayTrades, accounts, riskRules }: RiskRulesBarsProps) {
  // One block per Apex account, each held to its own plan (lib/account-risk).
  const groups = useMemo(
    () => accountRiskGroups(todayTrades, accounts, riskRules).map((g) => ({ g, u: accountRiskUsage(g) })),
    [todayTrades, accounts, riskRules],
  )

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Risk Rules</h3>

      <div className="space-y-6">
        {groups.map(({ g, u }) => {
          const lossHit = u.dailyLoss >= g.dailyLossLimit
          const losersHit = u.losers >= g.maxLosers
          return (
            <div key={g.key}>
              {groups.length > 1 && (
                <p className="text-xs font-semibold text-gray-400 mb-3">
                  {g.label}
                  <span className="font-normal text-gray-600">
                    {g.fromPlan ? ' · trading plan' : ' · Settings limits — link these to an account'}
                  </span>
                </p>
              )}
              <div className="space-y-5">
                <RuleBar
                  label="Daily Loss Limit"
                  current={u.dailyLoss}
                  max={g.dailyLossLimit}
                  format={formatCurrency}
                />
                <RuleBar
                  label={g.losersMode === 'total' ? 'Losers Today' : 'Consecutive Losses'}
                  current={u.losers}
                  max={g.maxLosers}
                  format={(v) => `${v} loss${v !== 1 ? 'es' : ''}`}
                />
              </div>

              {/* Status indicator */}
              <div className={cn(
                'mt-4 px-3 py-2 rounded-lg text-xs font-medium',
                lossHit || losersHit
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : u.dailyLoss >= g.dailyLossLimit * 0.8
                  ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              )}>
                {lossHit
                  ? 'DAILY LOSS LIMIT HIT — Stop trading'
                  : losersHit
                  ? g.losersMode === 'total'
                    ? `${g.maxLosers} LOSERS — Day is done`
                    : 'CONSECUTIVE LOSS LIMIT — Take a break'
                  : 'Risk rules OK — Trade with discipline'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
