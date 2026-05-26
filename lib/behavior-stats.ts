import type { DailySession, Trade } from '@/types'
import { isReviewComplete } from '@/lib/eod-gate'

/**
 * Behavior Patterns — deterministic per-day discipline stats for the
 * weekly review. Pairs with sub-projects A (EOD gate) and B (Pre-Session
 * Ritual) to surface the doc's "behavior patterns, not P&L patterns"
 * weekly view.
 *
 * Spec: docs/superpowers/specs/2026-05-26-behavior-patterns-design.md
 */

export type PnLClass = 'win' | 'loss' | 'breakeven'

export interface DayBehavior {
  date: string // YYYY-MM-DD
  dayOfWeek: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri'
  ritualCompleted: boolean
  eodCompleted: boolean | null // null when no trades that day
  netPnL: number | null // null when no trades
  pnlClass: PnLClass | null // null when no trades
}

export interface BehaviorStats {
  days: DayBehavior[] // 5 entries (Mon-Fri of the week)
  ritualCompletion: { done: number; total: number } // total = 5 (weekdays)
  eodCompletion: { done: number; total: number } // total = trading-day count
  pnlClassCounts: { win: number; loss: number; breakeven: number }
  currentStreak: number // consecutive weekday streak days ending most recently
  ritualDelta: number // current week ritual_done - prior week ritual_done
  eodDelta: number // current week eod_done - prior week eod_done
}

const DAY_LABELS: DayBehavior['dayOfWeek'][] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/**
 * Add `n` days to a YYYY-MM-DD date string. Uses UTC date math which is
 * safe here because we're only ever computing date offsets, not
 * times-of-day.
 */
function addDays(yyyyMmDd: string, n: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  const yyyy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function classifyPnL(netPnL: number): PnLClass {
  if (netPnL > 0) return 'win'
  if (netPnL < 0) return 'loss'
  return 'breakeven'
}

/**
 * Builds 5 DayBehavior entries (Mon-Fri) for the week starting at
 * `weekStartIso` (a Monday in YYYY-MM-DD format).
 */
function buildDayBehaviors(
  weekStartIso: string,
  sessions: DailySession[],
  trades: Trade[],
): DayBehavior[] {
  return DAY_LABELS.map((label, i) => {
    const date = addDays(weekStartIso, i)
    const session = sessions.find((s) => s.date === date) ?? null
    const tradesForDay = trades.filter((t) => t.date === date)
    const hasTrades = tradesForDay.length > 0

    const netPnL = hasTrades
      ? tradesForDay.reduce((sum, t) => sum + (t.net_pnl ?? 0), 0)
      : null
    const pnlClass = netPnL === null ? null : classifyPnL(netPnL)

    const ritualCompleted = session?.checklist_passed === true
    const eodCompleted = hasTrades ? isReviewComplete(session) : null

    return {
      date,
      dayOfWeek: label,
      ritualCompleted,
      eodCompleted,
      netPnL,
      pnlClass,
    }
  })
}

/**
 * Returns the count of consecutive streak days ending with the most
 * recent weekday in `daysChronological`.
 *
 * A "streak day" = ritual done AND (no trades OR EOD done).
 *
 * Walks BACKWARD from the last entry. Stops at the first non-streak day.
 */
function computeStreak(daysChronological: DayBehavior[]): number {
  let count = 0
  for (let i = daysChronological.length - 1; i >= 0; i--) {
    const d = daysChronological[i]
    const eodOk = d.eodCompleted === null || d.eodCompleted === true
    const isStreakDay = d.ritualCompleted && eodOk
    if (!isStreakDay) break
    count++
  }
  return count
}

/**
 * Main entrypoint. Computes the full BehaviorStats for the displayed week.
 *
 * Streak is computed across current + prior week (10 weekdays max).
 * For v1, the streak shown is "as of the end of the displayed week" —
 * accurate when viewing the current week, historical-snapshot when
 * viewing prior weeks. Acceptable limitation per spec.
 */
export function computeBehaviorStats(
  weekStartIso: string,
  weekSessions: DailySession[],
  weekTrades: Trade[],
  priorWeekSessions: DailySession[],
  priorWeekTrades: Trade[],
): BehaviorStats {
  const priorWeekStartIso = addDays(weekStartIso, -7)
  const priorDays = buildDayBehaviors(priorWeekStartIso, priorWeekSessions, priorWeekTrades)
  const days = buildDayBehaviors(weekStartIso, weekSessions, weekTrades)

  // Ritual: out of 5 weekdays
  const ritualCompletion = {
    done: days.filter((d) => d.ritualCompleted).length,
    total: 5,
  }

  // EOD: out of trading days only
  const tradingDays = days.filter((d) => d.eodCompleted !== null)
  const eodCompletion = {
    done: tradingDays.filter((d) => d.eodCompleted === true).length,
    total: tradingDays.length,
  }

  // P&L day classification
  const pnlClassCounts = {
    win: days.filter((d) => d.pnlClass === 'win').length,
    loss: days.filter((d) => d.pnlClass === 'loss').length,
    breakeven: days.filter((d) => d.pnlClass === 'breakeven').length,
  }

  // Streak: combine prior + current week in chronological order, then walk backward
  const allDays = [...priorDays, ...days]
  const currentStreak = computeStreak(allDays)

  // Deltas
  const priorRitualDone = priorDays.filter((d) => d.ritualCompleted).length
  const priorTradingDays = priorDays.filter((d) => d.eodCompleted !== null)
  const priorEodDone = priorTradingDays.filter((d) => d.eodCompleted === true).length

  return {
    days,
    ritualCompletion,
    eodCompletion,
    pnlClassCounts,
    currentStreak,
    ritualDelta: ritualCompletion.done - priorRitualDone,
    eodDelta: eodCompletion.done - priorEodDone,
  }
}
