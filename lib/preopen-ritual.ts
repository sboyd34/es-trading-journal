import type { DailySession } from '@/types'
import { getTodayChicagoDateString } from '@/lib/eod-gate'

/**
 * Pre-Session Ritual — 15 anti-greed/anti-impatience rules read aloud
 * before the open, plus a 4-item Pre-Open Check.
 *
 * Spec: docs/superpowers/specs/2026-05-26-preopen-ritual-design.md
 * Source: Trading_Journal_ES_MES.docx §1.4 (verbatim).
 */

/** Verbatim from the doc — hardcoded to prevent impulsive mid-drawdown edits. */
export const THE_15_RULES: readonly string[] = [
  'Stop loss is set BEFORE entry, every time, via the bracket order. No entry without a defined stop.',
  'Stops move in my favor only. Never widen a stop. A widened stop is just a bigger loss waiting to happen.',
  'Never add to a losing position. Averaging down is the fastest path to a max-drawdown breach.',
  'Scale out at TP1 — always. The 50% off at 1R turns greedy holds into free trades on the runner.',
  'Hit the daily profit target → platform CLOSED. Not minimized, not "one more." Closed.',
  'Hit the max daily loss → platform CLOSED. The next trade is always the worst trade. Stop.',
  '3 losses in a row → STOP for the day, even if I haven’t hit max loss. My read is wrong today.',
  'Mandatory 10-minute cooldown after any loss. Stand up, walk away. No re-entry inside 10 minutes.',
  'Position size is locked at session start. No sizing up mid-session, even on a heater.',
  'Two-strike rule on setups: if the same setup fails twice in a row, skip it for the day.',
  'No trading FOMC / CPI / NFP windows on these account sizes. Drawdowns are too tight.',
  'No trading the midday chop (11:00–14:00 ET). Open and last hour only.',
  'ES is OFF-LIMITS until I have a funded account with $750+ buffer above the locked drawdown.',
  'On the PA, the first $100 (25K) / $250 (50K) is sacred. After that, ONE optional trade. Then done.',
  'If I am behind pace on the 30-day eval, the rule is RESET if needed — not size up. A failed reset is cheaper than a blown PA.',
] as const

/** The 4 Pre-Open Check items with their persistence keys. */
export const PRE_OPEN_CHECK_ITEMS = [
  { key: 'rules_read' as const, label: 'I have read the rules page out loud' },
  { key: 'bracket_loaded' as const, label: 'My bracket template is loaded and tested' },
  { key: 'targets_written' as const, label: 'My daily targets and limits are written down' },
  { key: 'not_revenge_trading' as const, label: 'I am not trading to recover yesterday’s losses' },
] as const

const TZ = 'America/Chicago'

/**
 * Returns true when today is a weekday (Mon-Fri in Chicago time) AND
 * the user hasn't yet completed today's ritual (checklist_passed !== true).
 *
 * Used by the dashboard PreSessionBanner to decide whether to render.
 */
export function isRitualPending(now: Date, session: DailySession | null): boolean {
  // Weekday-only filter per design Q4 (B)
  const chicagoDayString = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' })
  const isWeekday = chicagoDayString !== 'Sat' && chicagoDayString !== 'Sun'
  if (!isWeekday) return false

  // Ritual is complete when checklist_passed is true (set on Save click)
  if (session?.checklist_passed === true) return false

  return true
}

// Re-export for convenience to consumers that need both helpers
export { getTodayChicagoDateString }
