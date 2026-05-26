import type { Trade, DailySession } from '@/types'

/**
 * EOD Review Gate — hides today's P&L until the 3 doc-mandated questions
 * are answered, enforcing "process before outcome" discipline.
 *
 * Spec: docs/superpowers/specs/2026-05-25-eod-review-gate-design.md
 */

// The 3 fields from end_of_day_summary that must be non-empty to unlock the gate.
// Maps to the doc's End-of-Day Review questions Q1/Q2/Q3.
export const GATE_REQUIRED_FIELDS = [
  'mistakes', // Q1: Which rules did I follow today, and which did I break? Why?
  'emotional_state', // Q2: If I broke a rule, what was the emotional trigger?
  'tomorrow_focus', // Q3: What is the ONE adjustment I will make tomorrow?
] as const

// Wall-clock floor for when the gate engages, in HHMM (Chicago time).
// Matches the rthEndTime convention used by ES_10x_Integrated.ts.
const RTH_END_TIME_HHMM = 1500

// Minutes after the last trade's exit before the gate engages.
// Acts as a "are you done trading?" debounce.
const POST_TRADE_BUFFER_MINUTES = 30

const TZ = 'America/Chicago'

/**
 * Returns today's date as YYYY-MM-DD in America/Chicago timezone.
 * Used to filter trades and select the correct daily_sessions row.
 */
export function getTodayChicagoDateString(now: Date = new Date()): string {
  // toLocaleDateString with en-CA gives ISO-ish YYYY-MM-DD format
  return now.toLocaleDateString('en-CA', { timeZone: TZ })
}

/**
 * True when the daily_sessions row for today has all 3 gate-required fields
 * filled with non-empty trimmed text.
 */
export function isReviewComplete(session: DailySession | null): boolean {
  if (!session?.end_of_day_summary) return false
  const summary = session.end_of_day_summary
  return GATE_REQUIRED_FIELDS.every((key) => {
    const value = summary[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

/**
 * Returns the Date at which the gate engages today.
 * Formula: MAX(rthEndTime, lastTradeExit + POST_TRADE_BUFFER_MINUTES).
 * If no trades today, returns today's rthEndTime.
 */
export function getGateEngageTime(now: Date, todayTrades: Trade[]): Date {
  const rthCloseToday = makeChicagoTimeOnDate(now, RTH_END_TIME_HHMM)
  if (todayTrades.length === 0) return rthCloseToday

  const lastExitMs = Math.max(
    ...todayTrades.map((t) => new Date(t.exit_time).getTime()),
  )
  const bufferMs = lastExitMs + POST_TRADE_BUFFER_MINUTES * 60 * 1000

  return new Date(Math.max(rthCloseToday.getTime(), bufferMs))
}

/**
 * True when the gate should be visible (hiding today's P&L).
 * - False if no trades today (nothing to review)
 * - False if today's review is complete
 * - False if now is before the gate engage time (operational mode)
 * - True otherwise
 */
export function isGateActive(
  now: Date,
  todayTrades: Trade[],
  session: DailySession | null,
): boolean {
  if (todayTrades.length === 0) return false
  if (isReviewComplete(session)) return false
  return now.getTime() >= getGateEngageTime(now, todayTrades).getTime()
}

/**
 * Constructs a Date representing the given HHMM (e.g., 1500) on the calendar
 * day in Chicago timezone that `referenceDate` falls within.
 *
 * Implementation note: JavaScript Date doesn't have native timezone support.
 * We construct the target time by:
 *   1. Getting today's Chicago-local Y/M/D parts.
 *   2. Building a UTC date with those parts at the target HHMM.
 *   3. Adjusting by Chicago's UTC offset for that date.
 */
function makeChicagoTimeOnDate(referenceDate: Date, hhmm: number): Date {
  const dateStr = referenceDate.toLocaleDateString('en-CA', { timeZone: TZ })
  // Parse YYYY-MM-DD
  const [y, m, d] = dateStr.split('-').map((s) => parseInt(s, 10))
  const hh = Math.floor(hhmm / 100)
  const mm = hhmm % 100

  // Build a Date in UTC, then adjust by Chicago's offset for this date.
  // Chicago's offset is -5 (CDT) or -6 (CST) depending on DST.
  // We compute it by comparing the same wall clock in UTC vs Chicago.
  const wallUtc = Date.UTC(y, m - 1, d, hh, mm, 0)
  const chicagoWallString = new Date(wallUtc).toLocaleString('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  // chicagoWallString format: MM/DD/YYYY, HH:MM:SS
  const match = chicagoWallString.match(
    /(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/,
  )
  if (!match) return new Date(wallUtc) // fallback — shouldn't happen
  const [, cm, cd, cy, ch, cmin, cs] = match
  const chicagoWallUtc = Date.UTC(
    parseInt(cy, 10),
    parseInt(cm, 10) - 1,
    parseInt(cd, 10),
    parseInt(ch, 10),
    parseInt(cmin, 10),
    parseInt(cs, 10),
  )
  // offset = (UTC wall - Chicago wall as if UTC) tells us Chicago's offset
  const offsetMs = wallUtc - chicagoWallUtc
  // The real UTC time of "HH:MM Chicago on date Y-M-D" is wallUtc + offset
  return new Date(wallUtc + offsetMs)
}
