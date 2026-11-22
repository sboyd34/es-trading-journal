import type { ApexAccount, RiskRules, Trade } from '@/types'
import { TRADING_PLAN, type PlanSize } from '@/lib/apex-config'

// Groups today's trades by Apex account so each is held to its own plan's
// daily limits (TRADING_PLAN) instead of one shared Settings row. Trades with
// no linked account fall back to the Settings risk_rules — never guessed onto
// an account, since that would charge one account's losses to another's plan.

export interface AccountRiskGroup {
  key: string
  label: string
  trades: Trade[]
  dailyLossLimit: number
  maxLosers: number
  // The plan's "two losers, done" counts every losing trade today; the
  // Settings rule counts a consecutive streak.
  losersMode: 'total' | 'consecutive'
  fromPlan: boolean
}

export interface AccountRiskUsage {
  dailyLoss: number
  losers: number
}

export function accountRiskGroups(
  todayTrades: Trade[],
  accounts: ApexAccount[],
  fallback: RiskRules,
): AccountRiskGroup[] {
  const settingsGroup = (key: string, label: string, trades: Trade[]): AccountRiskGroup => ({
    key, label, trades,
    dailyLossLimit: fallback.max_daily_loss,
    maxLosers: fallback.max_consecutive_losses,
    losersMode: 'consecutive',
    fromPlan: false,
  })

  if (accounts.length === 0) return [settingsGroup('all', 'All trades', todayTrades)]

  const ids = new Set(accounts.map((a) => a.id))
  const groups: AccountRiskGroup[] = accounts.map((a) => {
    const trades = todayTrades.filter((t) => t.account_id === a.id)
    const plan = TRADING_PLAN[a.account_size as PlanSize]
    if (!plan) return settingsGroup(a.id, a.name, trades)
    return {
      key: a.id,
      label: a.name,
      trades,
      dailyLossLimit: plan.dailyLossHard,
      maxLosers: plan.maxLosers,
      losersMode: 'total',
      fromPlan: true,
    }
  })

  const unlinked = todayTrades.filter((t) => !t.account_id || !ids.has(t.account_id))
  if (unlinked.length > 0) groups.push(settingsGroup('unlinked', 'Unlinked trades', unlinked))
  return groups
}

export function accountRiskUsage(g: AccountRiskGroup): AccountRiskUsage {
  const net = g.trades.reduce((s, t) => s + t.net_pnl, 0)
  let losers = 0
  if (g.losersMode === 'total') {
    losers = g.trades.filter((t) => t.net_pnl < 0).length
  } else {
    for (let i = g.trades.length - 1; i >= 0 && g.trades[i].net_pnl < 0; i--) losers++
  }
  return { dailyLoss: Math.max(-net, 0), losers }
}
