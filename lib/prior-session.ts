// Last-session "tilt guardrail" for the pre-market brief.
//
// The journal exists to close the loop between yesterday's behavior and today's
// plan. If the most recent session was a loss, the brief should open
// what_not_to_do with a revenge-trade guardrail — the A+ playbook already
// preaches "one look per level, don't revenge-chase," and this personalizes it.
//
// Input is the same rows the brief callers already fetch for edge stats
// (net_pnl + entry_time), so this needs no extra query and no schema change.

export interface PriorSessionTrade {
  net_pnl: number
  entry_time: string // ISO timestamp
}

export interface PriorSession {
  date: string // YYYY-MM-DD of the most recent session with trades
  trades: number
  wins: number
  losses: number
  scratches: number
  netPnl: number
  outcome: 'green' | 'red' | 'scratch'
}

function toDate(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * Aggregate the most recent trading day present in the rows. Returns null when
 * there are no trades at all (nothing to caution about).
 */
export function computePriorSession(trades: PriorSessionTrade[]): PriorSession | null {
  if (!trades || trades.length === 0) return null

  let lastDate = ''
  for (const t of trades) {
    const d = toDate(t.entry_time)
    if (d > lastDate) lastDate = d
  }
  if (!lastDate) return null

  const bucket = trades.filter((t) => toDate(t.entry_time) === lastDate)
  const netPnl = bucket.reduce((acc, t) => acc + (t.net_pnl ?? 0), 0)
  const wins = bucket.filter((t) => t.net_pnl > 0).length
  const losses = bucket.filter((t) => t.net_pnl < 0).length
  const scratches = bucket.filter((t) => t.net_pnl === 0).length
  const outcome: PriorSession['outcome'] =
    netPnl > 0 ? 'green' : netPnl < 0 ? 'red' : 'scratch'

  return { date: lastDate, trades: bucket.length, wins, losses, scratches, netPnl, outcome }
}

function calendarDaysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(`${fromYmd}T00:00:00Z`).getTime()
  const b = new Date(`${toYmd}T00:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

function money(n: number): string {
  const sign = n < 0 ? '-' : '+'
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
}

/**
 * Render the tilt section. Returns '' when there is no prior session. The copy
 * leans hardest after a red day; green/scratch days get a lighter, anti-
 * complacency note so the section never reads as a license to size up.
 */
export function formatPriorSessionSection(
  ps: PriorSession | null,
  today: string,
): string {
  if (!ps) return ''

  const daysAgo = calendarDaysBetween(ps.date, today)
  const when =
    daysAgo <= 0
      ? 'today so far'
      : daysAgo === 1
        ? 'yesterday'
        : `${daysAgo} days ago (${ps.date})`
  const record = `${ps.wins}W–${ps.losses}L${ps.scratches ? `–${ps.scratches}S` : ''}`
  const head =
    `\n\nLast trading session (${when}): ${money(ps.netPnl)} net on ${ps.trades} ` +
    `trade${ps.trades === 1 ? '' : 's'} (${record}).`

  let guidance = ''
  if (ps.outcome === 'red') {
    guidance =
      ' This was a RED session — open what_not_to_do with an explicit ' +
      'revenge-trade guardrail: no size-up to "win it back," no trading outside ' +
      'an approved window to force a setup, and honor "one look per level." ' +
      'Demand a clean Bias-Setup-Trigger-Location-Risk before the first entry.'
  } else if (ps.outcome === 'green') {
    guidance =
      ' This was a GREEN session — guard against overconfidence: yesterday\'s ' +
      'win does not lower today\'s standards. Same setups, same locations, same ' +
      'size. No victory-lap trades.'
  } else {
    guidance =
      ' This was a scratch — neutral. Hold the line on the checklist; do not ' +
      'manufacture a trade out of boredom.'
  }

  return head + guidance
}
