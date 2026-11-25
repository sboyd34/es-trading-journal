import type { ApexAccount, Trade } from '@/types'
import { TRADING_PLAN, type PlanSize } from '@/lib/apex-config'

// Plan Replay: re-run each account-day of real trades under the trading
// plan's DAILY rules (lib/apex-config TRADING_PLAN) and compare the P&L the
// plan would have kept against what actually happened.
//
// After each trade, in order: hard daily stop → loser limit (plan.maxLosers) → profit target.
// The first one that fires ends the day; later trades count as skipped.
// The profit target fires once the day's running P&L reaches it.
//
// Size rules (ES where the plan forbids it, ES over its contract max, a loss
// over the per-trade max) are FLAGGED, not re-priced: turning an ES fill into
// "what 7 MES would have made" needs fill assumptions the journal can't
// support. An allowed 1-ES trade is held to its bracket, not the dollar band:
// on the 25K its $100 stop sits above the $75 band by the trader's choice.

export interface ReplayTrade {
  trade: Trade
  taken: boolean
  flags: string[]
}

export interface ReplayDay {
  date: string
  accountId: string
  accountName: string
  trades: ReplayTrade[]
  actual: number
  plan: number
  stopReason: string | null
  stopAfter: number | null // 1-based index of the trade that triggered the stop
}

export interface ReplaySummary {
  days: ReplayDay[]
  actual: number
  plan: number
  skippedWinners: number // P&L of winners the plan would have skipped (≥ 0)
  skippedLosers: number  // P&L of losers the plan would have skipped (≤ 0)
  flaggedTrades: number
  unlinked: number       // trades with no account (or no plan) — not replayed
}

export function replayPlan(trades: Trade[], accounts: ApexAccount[]): ReplaySummary {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const groups = new Map<string, Trade[]>()
  let unlinked = 0

  for (const t of trades) {
    const acct = t.account_id ? byId.get(t.account_id) : undefined
    if (!acct || !TRADING_PLAN[acct.account_size as PlanSize]) { unlinked++; continue }
    const key = `${t.date}|${acct.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  const days: ReplayDay[] = []
  for (const [key, dayTrades] of Array.from(groups.entries())) {
    const [date, accountId] = key.split('|')
    const acct = byId.get(accountId)!
    const plan = TRADING_PLAN[acct.account_size as PlanSize]
    const ordered = [...dayTrades].sort((a, b) => a.entry_time.localeCompare(b.entry_time))

    let running = 0
    let losers = 0
    let stopReason: string | null = null
    let stopAfter: number | null = null

    const replayed = ordered.map((trade, i): ReplayTrade => {
      const flags: string[] = []
      const esAllowed = trade.instrument === 'ES' && (plan.es.allowed === 'yes' || acct.mode === 'pa')
      if (trade.instrument === 'ES' && !esAllowed) {
        flags.push(`ES on the ${acct.account_size / 1000}K eval`)
      }
      if (esAllowed && trade.quantity > plan.es.maxContracts) {
        flags.push(`${trade.quantity}x ES — plan max is ${plan.es.maxContracts}`)
      } else if (!esAllowed && trade.net_pnl < -plan.riskPerTrade.max) {
        flags.push(`Loss over the $${plan.riskPerTrade.max} per-trade max`)
      }

      const taken = stopReason === null
      if (taken) {
        running += trade.net_pnl
        if (trade.net_pnl < 0) losers++
        if (running <= -plan.dailyLossHard) stopReason = `Hard daily stop (-$${plan.dailyLossHard})`
        else if (losers >= plan.maxLosers) stopReason = `${plan.maxLosers} losers`
        else if (running >= plan.dailyProfitTarget) stopReason = `Profit target (+$${plan.dailyProfitTarget})`
        if (stopReason !== null) stopAfter = i + 1
      }
      return { trade, taken, flags }
    })

    // No stop needed if the stopping trade was the day's last one.
    if (stopAfter === ordered.length) { stopReason = null; stopAfter = null }

    days.push({
      date,
      accountId,
      accountName: acct.name,
      trades: replayed,
      actual: ordered.reduce((s, t) => s + t.net_pnl, 0),
      plan: running,
      stopReason,
      stopAfter,
    })
  }

  days.sort((a, b) => b.date.localeCompare(a.date) || a.accountName.localeCompare(b.accountName))

  const skipped = days.flatMap((d) => d.trades.filter((r) => !r.taken).map((r) => r.trade.net_pnl))
  return {
    days,
    actual: days.reduce((s, d) => s + d.actual, 0),
    plan: days.reduce((s, d) => s + d.plan, 0),
    skippedWinners: skipped.filter((p) => p > 0).reduce((s, p) => s + p, 0),
    skippedLosers: skipped.filter((p) => p < 0).reduce((s, p) => s + p, 0),
    flaggedTrades: days.reduce((s, d) => s + d.trades.filter((r) => r.flags.length > 0).length, 0),
    unlinked,
  }
}
