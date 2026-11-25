import { MES_BRACKET, TRADING_PLAN, type PlanSize } from './apex-config'

// One account's trading day checked against its own TRADING_PLAN, computed in
// code so AI reviews cite facts instead of doing the arithmetic. The weekly
// review once summed two accounts' trades against a single -$250 stop and
// called a green 50K day a daily-stop breach while missing the 25K's four
// losers. Dependency-free so scripts/test-account-day-rules.mts can run it.

export interface DayTrade {
  no: number            // the trade's chronological number within the whole day
  instrument: string | null
  quantity: number
  net_pnl: number
}

export interface AccountForRules {
  account_size: number
  mode: 'evaluation' | 'pa'
}

export interface SizeBreach {
  no: number
  detail: string
}

export interface AccountDayFacts {
  net: number
  losers: number
  // Trade number that hit the hard stop (the plan's Nth loser, or the running
  // net reaching -dailyLossHard, whichever came first), and trades after it.
  hardStopAt: number | null
  hardStopReason: string | null
  tradesAfterHardStop: number[]
  // Trade number whose close put the day at the profit target.
  profitTarget: number
  profitTargetAt: number | null
  tradesAfterProfitTarget: number[]
  sizeBreaches: SizeBreach[]
}

export function planForAccount(account: AccountForRules) {
  return TRADING_PLAN[account.account_size as PlanSize] ?? null
}

// Trades must be in chronological order.
export function accountDayFacts(trades: DayTrade[], account: AccountForRules): AccountDayFacts | null {
  const plan = planForAccount(account)
  if (!plan) return null

  let net = 0
  let losers = 0
  let hardStopAt: number | null = null
  let hardStopReason: string | null = null
  let profitTargetAt: number | null = null
  const sizeBreaches: SizeBreach[] = []

  for (const t of trades) {
    net += t.net_pnl
    if (t.net_pnl < 0) losers++

    if (hardStopAt === null) {
      if (losers >= plan.maxLosers) {
        hardStopAt = t.no
        hardStopReason = `loser #${losers} of the day (plan: ${plan.maxLosers} losers, done)`
      } else if (net <= -plan.dailyLossHard) {
        hardStopAt = t.no
        hardStopReason = `day net reached -$${plan.dailyLossHard} hard stop`
      }
    }
    if (profitTargetAt === null && net >= plan.dailyProfitTarget) profitTargetAt = t.no

    const inst = (t.instrument || 'ES').toUpperCase()
    if (inst === 'ES') {
      if (plan.es.allowed !== 'yes' && account.mode === 'evaluation') {
        sizeBreaches.push({ no: t.no, detail: `/ES is not allowed on this account in the eval (${t.quantity}x ES)` })
      } else if (t.quantity > plan.es.maxContracts) {
        sizeBreaches.push({ no: t.no, detail: `${t.quantity}x ES — plan max is ${plan.es.maxContracts}` })
      }
    } else if (inst === 'MES' && t.quantity > MES_BRACKET.contracts) {
      sizeBreaches.push({ no: t.no, detail: `${t.quantity}x MES — the bracket is ${MES_BRACKET.contracts} contracts` })
    }
  }

  return {
    net,
    losers,
    hardStopAt,
    hardStopReason,
    tradesAfterHardStop: hardStopAt === null ? [] : trades.filter((t) => t.no > hardStopAt!).map((t) => t.no),
    profitTarget: plan.dailyProfitTarget,
    profitTargetAt,
    tradesAfterProfitTarget: profitTargetAt === null ? [] : trades.filter((t) => t.no > profitTargetAt!).map((t) => t.no),
    sizeBreaches,
  }
}

// The fact lines as the review prompt sees them.
export function accountDayFactLines(f: AccountDayFacts): string[] {
  const nos = (ns: number[]) => ns.map((n) => `#${n}`).join(', ')
  const lines = [`Day net $${f.net.toFixed(2)}, ${f.losers} loser(s)`]
  lines.push(f.hardStopAt === null
    ? 'Hard stop: not reached'
    : `Hard stop hit at trade #${f.hardStopAt} (${f.hardStopReason}); ` +
      (f.tradesAfterHardStop.length ? `traded after it: ${nos(f.tradesAfterHardStop)} — VIOLATION` : 'no trades after it — respected'))
  if (f.profitTargetAt !== null) {
    lines.push(`Daily profit target (+$${f.profitTarget}) reached at trade #${f.profitTargetAt}; ` +
      (f.tradesAfterProfitTarget.length ? `traded after it: ${nos(f.tradesAfterProfitTarget)} (plan: "then stop")` : 'stopped — respected'))
  }
  lines.push(f.sizeBreaches.length
    ? `Size breaches: ${f.sizeBreaches.map((b) => `#${b.no} ${b.detail}`).join('; ')}`
    : 'Size breaches: none')
  return lines
}
