import { ES_BRACKET } from '@/lib/apex-config'

// Bracket what-if: replay every trade as 1 ES with a fixed stop and target, and
// say honestly how much of the answer is known.
//
// A trade's outcome under a bracket depends on its PATH — did price reach the
// target before the stop? The journal knows the path only partly:
//   - definite: hand-entered MFE/MAE shows exactly one level was reached
//   - likely:   no MFE/MAE, but the exit itself proves a level was reached
//               (closed ≥ target pts → target hit; closed ≤ -stop pts → stop
//               hit); which came first is unknown
//   - unknown:  both levels touched (order unknown), or the trade was closed
//               before reaching either, so the bracket would still be running
//
// So the result is a RANGE: unknowns all lost, all won, or at the known win
// rate. The known sample leans toward losses, and more so for wide targets — a
// loss is proven by any close past the stop, a win only by evidence of the
// full target — so the known win rate understates the truth as targets widen.
//
// MFE/MAE are hand-entered; a value smaller than the trade's own exit is a
// typo (nothing closes beyond its best price) and is raised to the exit.

export interface BracketTrade {
  direction: string
  entry_price: number
  exit_price: number
  mfe: number | null // points, per contract
  mae: number | null // points, per contract (sign ignored)
}

export interface BracketWhatIf {
  stopTicks: number
  targetTicks: number
  winPnl: number
  lossPnl: number
  breakevenRate: number // %
  definiteWin: number
  definiteLoss: number
  likelyWin: number
  likelyLoss: number
  orderUnknown: number
  exitedEarly: number
  typoFixes: number
  resolved: number
  wins: number
  losses: number
  winRate: number | null // % over resolved trades
  resolvedNet: number
  expectancy: number | null // per trade, at the resolved win rate
  estimateAll: number | null // all trades, unknowns at the resolved win rate
  worstAll: number // unknowns all lost
  bestAll: number // unknowns all won
  total: number
}

const TICK = 0.25

// Bracket Sweep grid, in ticks, around the plan's /ES bracket (ES_BRACKET).
// Shared by the sweep route and page (route files may only export handlers,
// so the constants live here).
export const SWEEP_STOP_TICKS = [6, 8, 10, 12, 16]
export const SWEEP_TARGET_TICKS = [8, 12, 16, 20, 24, 32]
export const PLAN_BRACKET = ES_BRACKET
// "Best combo" needs this many known outcomes, so a cell resting on a handful
// of trades cannot win on noise...
export const SWEEP_MIN_RESOLVED = 10
// ...AND at least this share of all trades known. The bias runs both ways: a
// wide target makes wins hard to prove (known win rate too LOW), and a wide
// stop makes losses hard to prove (too HIGH). Without this guard a 16-tick
// stop / 12-tick target cell "won" at +$73/trade with 34 of 53 unknown.
export const SWEEP_MIN_RESOLVED_SHARE = 0.5

export function bracketWhatIf(
  trades: BracketTrade[],
  stopTicks: number,
  targetTicks: number,
  opts: { pointValue?: number; fee?: number } = {},
): BracketWhatIf {
  const pv = opts.pointValue ?? 50
  const fee = opts.fee ?? 0
  const stop = stopTicks * TICK
  const target = targetTicks * TICK
  const winPnl = target * pv - fee
  const lossPnl = -stop * pv - fee

  let definiteWin = 0, definiteLoss = 0, likelyWin = 0, likelyLoss = 0
  let orderUnknown = 0, exitedEarly = 0, typoFixes = 0

  for (const t of trades) {
    const r = (t.direction === 'long' ? 1 : -1) * (t.exit_price - t.entry_price)
    let mfe = t.mfe != null ? Math.abs(t.mfe) : null
    let mae = t.mae != null ? Math.abs(t.mae) : null
    if (mfe != null && r > mfe) { mfe = r; typoFixes++ }
    if (mae != null && -r > mae) { mae = -r; typoFixes++ }

    if (mfe != null && mae != null) {
      const hitT = mfe >= target
      const hitS = mae >= stop
      if (hitT && !hitS) definiteWin++
      else if (hitS && !hitT) definiteLoss++
      else if (hitT && hitS) orderUnknown++
      else exitedEarly++
    } else if (r >= target) likelyWin++
    else if (r <= -stop) likelyLoss++
    else exitedEarly++
  }

  const wins = definiteWin + likelyWin
  const losses = definiteLoss + likelyLoss
  const resolved = wins + losses
  const total = trades.length
  const unknown = orderUnknown + exitedEarly
  const rate = resolved > 0 ? wins / resolved : null
  const expectancy = rate === null ? null : rate * winPnl + (1 - rate) * lossPnl

  return {
    stopTicks,
    targetTicks,
    winPnl,
    lossPnl,
    breakevenRate: (100 * -lossPnl) / (winPnl - lossPnl),
    definiteWin,
    definiteLoss,
    likelyWin,
    likelyLoss,
    orderUnknown,
    exitedEarly,
    typoFixes,
    resolved,
    wins,
    losses,
    winRate: rate === null ? null : rate * 100,
    resolvedNet: wins * winPnl + losses * lossPnl,
    expectancy,
    estimateAll: expectancy === null ? null : total * expectancy,
    worstAll: wins * winPnl + (losses + unknown) * lossPnl,
    bestAll: (wins + unknown) * winPnl + losses * lossPnl,
    total,
  }
}
