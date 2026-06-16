import { SYSTEM_SETUPS } from '@/lib/trading-system'
import type { Trade } from '@/types'

// Only the columns the brief callers fetch — keeps the input type honest.
export type EdgeTrade = Pick<
  Trade,
  'trade_bias' | 'trade_setup' | 'setup_tag' | 'net_pnl' | 'entry_time'
>

export interface EdgeStat {
  bias: 'Bull' | 'Bear' | 'Neutral'
  setup: string
  wins: number
  losses: number
  total: number // wins + losses; scratches (net_pnl === 0) excluded
  winRate: number // wins / total, 0–1
  avgNetPnl: number // mean net_pnl over the `total` trades
  firstDate: string // YYYY-MM-DD
  lastDate: string // YYYY-MM-DD
  thin: boolean // true when total is 3–4
}

const BIASES = ['Bull', 'Bear', 'Neutral'] as const

// Same matching semantics as FiveWordGateModal: case-insensitive substring
// over trade_setup + setup_tag.
function matchesSetup(t: EdgeTrade, setupName: string): boolean {
  if (!setupName) return false
  const haystack = [t.trade_setup, t.setup_tag].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(setupName.toLowerCase())
}

// entry_time is an ISO timestamp string; take the calendar date.
function toDate(iso: string): string {
  return iso.slice(0, 10)
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function monthRange(firstDate: string, lastDate: string): string {
  const fm = MONTHS[Number(firstDate.slice(5, 7)) - 1]
  const lm = MONTHS[Number(lastDate.slice(5, 7)) - 1]
  return fm === lm ? fm : `${fm}–${lm}`
}

/**
 * Bucket trades by (bias × setup). Drops buckets with ≤2 trades; tags buckets
 * with 3–4 trades as `thin`. Scratches (net_pnl === 0) are excluded entirely.
 */
export function computeEdgeStats(trades: EdgeTrade[]): EdgeStat[] {
  const stats: EdgeStat[] = []
  // 'No Setup' is the absence of a setup, not an edge to lean on — skip it.
  const setups = SYSTEM_SETUPS.filter((s) => s !== 'No Setup')

  for (const bias of BIASES) {
    for (const setup of setups) {
      const bucket = trades.filter(
        (t) =>
          (t.trade_bias ?? '').toLowerCase() === bias.toLowerCase() &&
          matchesSetup(t, setup) &&
          t.net_pnl !== 0,
      )
      const total = bucket.length
      if (total < 3) continue

      const wins = bucket.filter((t) => t.net_pnl > 0).length
      const sum = bucket.reduce((acc, t) => acc + t.net_pnl, 0)
      const dates = bucket.map((t) => toDate(t.entry_time)).sort()

      stats.push({
        bias,
        setup,
        wins,
        losses: total - wins,
        total,
        winRate: wins / total,
        avgNetPnl: sum / total,
        firstDate: dates[0],
        lastDate: dates[dates.length - 1],
        thin: total < 5,
      })
    }
  }
  return stats
}

/**
 * Render the stats into the prompt section. Full rows (N≥5) show win % + avg $;
 * thin rows (N=3–4) show record + count + range only. Returns '' when empty.
 */
export function formatEdgeStatsSection(stats: EdgeStat[]): string {
  if (stats.length === 0) return ''
  const lines = stats.map((s) => {
    const record = `${s.wins}–${s.losses}`
    const range = monthRange(s.firstDate, s.lastDate)
    if (s.thin) {
      return `- ${s.bias} · ${s.setup} [thin sample]: ${record} over ${s.total} trades (${range})`
    }
    const pct = Math.round(s.winRate * 100)
    const avg =
      s.avgNetPnl >= 0
        ? `+$${Math.round(s.avgNetPnl)}`
        : `-$${Math.abs(Math.round(s.avgNetPnl))}`
    return `- ${s.bias} · ${s.setup}: ${record} (${pct}%), ${avg} avg over ${s.total} trades (${range})`
  })
  return (
    '\n\nYour historical edge by setup and bias (all-time; use only the rows ' +
    "matching today's bias):\n" +
    lines.join('\n')
  )
}
