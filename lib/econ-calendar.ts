// US macro economic calendar for 2026 — the high-impact federal data releases
// that move /ES and gate the NY trading windows. Dates come from the authoritative
// OMB/OIRA "Schedule of Release Dates for Principal Federal Economic Indicators for
// 2026." Every monthly release prints at 08:30 ET = 07:30 CT; the FOMC statement
// lands 13:00 CT (press conference 13:30 CT). The ET→CT offset is a constant 1 hour
// year-round, so no DST math is needed here.
//
// Refresh once a year when the new OMB schedule is published. The day-of-month
// arrays map row-for-row to the PDF, so updating is a quick visual diff.
//
// Deliberately NOT included: ISM, Conference Board confidence, and Fed-speak — those
// aren't on the federal schedule, so we'd be guessing dates. Weekly jobless claims is
// omitted because its date shifts on holiday weeks and we can't guarantee it here.

export type MacroImpact = 'HIGH' | 'MED'

export interface MacroEvent {
  date: string // YYYY-MM-DD, America/Chicago calendar day
  name: string
  ctTime: string // HH:MM 24h, America/Chicago
  impact: MacroImpact
}

// Day-of-month per release, indexed Jan(0)..Dec(11). Transcribed from the OMB 2026 schedule.
const MONTHLY_RELEASES: Array<{ name: string; impact: MacroImpact; ctTime: string; days: number[] }> = [
  { name: 'CPI', impact: 'HIGH', ctTime: '07:30', days: [13, 11, 11, 10, 12, 10, 14, 12, 11, 14, 10, 10] },
  { name: 'Employment Situation (NFP)', impact: 'HIGH', ctTime: '07:30', days: [9, 6, 6, 3, 8, 5, 2, 7, 4, 2, 6, 4] },
  { name: 'PPI', impact: 'MED', ctTime: '07:30', days: [14, 12, 12, 14, 13, 11, 15, 13, 10, 15, 13, 15] },
  { name: 'Retail Sales', impact: 'MED', ctTime: '07:30', days: [15, 17, 16, 16, 14, 17, 16, 14, 16, 15, 17, 16] },
  { name: 'PCE (Personal Income & Outlays)', impact: 'MED', ctTime: '07:30', days: [29, 26, 27, 30, 28, 25, 30, 26, 30, 29, 25, 23] },
  { name: 'GDP', impact: 'MED', ctTime: '07:30', days: [29, 26, 27, 30, 28, 25, 30, 26, 30, 29, 25, 23] },
]

// FOMC rate decision — statement day (second day of each two-day meeting).
// Source: Federal Reserve 2026 tentative meeting schedule.
const FOMC_STATEMENT_DAYS = [
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Built once at module load: date string -> events that day, sorted by time.
const EVENTS_BY_DATE: Map<string, MacroEvent[]> = (() => {
  const map = new Map<string, MacroEvent[]>()
  const push = (e: MacroEvent) => {
    const list = map.get(e.date)
    if (list) list.push(e)
    else map.set(e.date, [e])
  }
  for (const rel of MONTHLY_RELEASES) {
    rel.days.forEach((day, monthIdx) => {
      push({ date: `2026-${pad(monthIdx + 1)}-${pad(day)}`, name: rel.name, ctTime: rel.ctTime, impact: rel.impact })
    })
  }
  for (const date of FOMC_STATEMENT_DAYS) {
    push({ date, name: 'FOMC rate decision', ctTime: '13:00', impact: 'HIGH' })
  }
  map.forEach((list) => list.sort((a, b) => a.ctTime.localeCompare(b.ctTime)))
  return map
})()

/** All macro events scheduled for the given America/Chicago calendar day (YYYY-MM-DD). */
export function getMacroEventsForDate(date: string): MacroEvent[] {
  return EVENTS_BY_DATE.get(date) ?? []
}

/** True if any event lands in 12:00–14:30 CT — the window whose macro events close
 *  the 12:30–14:00 NY secondary trading gate (today this only ever trips on FOMC). */
export function hasSecondaryWindowConflict(date: string): boolean {
  return getMacroEventsForDate(date).some((e) => e.ctTime >= '12:00' && e.ctTime <= '14:30')
}
