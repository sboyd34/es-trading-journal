import { Trade } from '@/types'

export type FlagType = 'apex_trade_count'
export type FlagSeverity = 'critical' | 'warning'

export interface TradeFlag {
  type: FlagType
  severity: FlagSeverity
  detail: string
}

// Returns the CT HH:MM string for display.
export function ctTimeLabel(entryTime: string): string | null {
  try {
    const d = new Date(entryTime)
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return null
  }
}

export type WindowStatus =
  // NY / RTH cash session
  | 'building' | 'primary' | 'continuation' | 'late' | 'dead_zone' | 'secondary'
  // Asia + London session opens (ORB replays at each)
  | 'tokyo_build' | 'tokyo_orb'
  | 'shanghai_build' | 'shanghai_orb'
  | 'london_build' | 'london_orb'
  // extended hours between session opens — tradeable, but secondary
  | 'eth'
  | 'unknown'

// Classify a CT minute count (minutes since midnight, America/Chicago) into a named
// trading window. ORB replays at each session open — Tokyo, Shanghai, London, NY —
// each a 15-min opening-range build followed by a 45-min ORB window. All time between
// sessions is extended hours: tradeable, but secondary to the session opens.
export function classifyWindow(mins: number): WindowStatus {
  // London open (02:00–03:00 CT)
  if (mins >= 120 && mins < 135) return 'london_build'     // 02:00–02:15
  if (mins >= 135 && mins < 180) return 'london_orb'       // 02:15–03:00
  // NY cash session (08:30–14:00 CT) — unchanged
  if (mins >= 510 && mins < 525) return 'building'         // 08:30–08:45 OR build
  if (mins >= 525 && mins <= 570) return 'primary'         // 08:45–09:30 ORB
  if (mins > 570 && mins <= 630) return 'continuation'     // 09:30–10:30
  if (mins > 630 && mins <= 660) return 'late'             // 10:30–11:00 A+ only
  if (mins > 660 && mins < 750) return 'dead_zone'         // 11:00–12:30 lunch dead zone
  if (mins >= 750 && mins <= 840) return 'secondary'       // 12:30–14:00 conditional
  // Tokyo open (19:00–20:00 CT)
  if (mins >= 1140 && mins < 1155) return 'tokyo_build'    // 19:00–19:15
  if (mins >= 1155 && mins < 1200) return 'tokyo_orb'      // 19:15–20:00
  // Shanghai open (20:30–21:30 CT)
  if (mins >= 1230 && mins < 1245) return 'shanghai_build' // 20:30–20:45
  if (mins >= 1245 && mins < 1290) return 'shanghai_orb'   // 20:45–21:30
  // Everything else: extended hours, tradeable but secondary
  return 'eth'
}

// Human-readable label per window — used in AI prompts, tooltips, the live indicator.
export const WINDOW_LABEL: Record<WindowStatus, string> = {
  building: 'NY OR build (no trades)',
  primary: 'NY ORB',
  continuation: 'NY continuation',
  late: 'NY A+ only',
  dead_zone: 'NY lunch dead zone (no trades)',
  secondary: 'NY secondary',
  tokyo_build: 'Tokyo OR build (no trades)',
  tokyo_orb: 'Tokyo ORB',
  shanghai_build: 'Shanghai OR build (no trades)',
  shanghai_orb: 'Shanghai ORB',
  london_build: 'London OR build (no trades)',
  london_orb: 'London ORB',
  eth: 'Extended hours',
  unknown: 'unknown',
}

// Build windows + the NY lunch dead zone: the rule is "build the range / stand down."
const NO_TRADE_WINDOWS: WindowStatus[] = [
  'building', 'tokyo_build', 'shanghai_build', 'london_build', 'dead_zone',
]

export function isNoTradeWindow(status: WindowStatus): boolean {
  return NO_TRADE_WINDOWS.includes(status)
}

// Whether a window is "approved" for an entry. Every session ORB, the NY
// continuation/late/secondary windows, and general extended hours are tradeable;
// the build windows and the NY lunch dead zone are not.
const APPROVED_WINDOWS: WindowStatus[] = [
  'primary', 'continuation', 'late', 'secondary',
  'tokyo_orb', 'shanghai_orb', 'london_orb', 'eth',
]

export function isApprovedWindow(status: WindowStatus): boolean {
  return APPROVED_WINDOWS.includes(status)
}

// Compute all rule flags for a single trade given the full trade list.
// The per-day trade-count rule was removed — there is no cap on trades per day.
export function computeTradeFlags(_trade: Trade, _allTrades: Trade[]): TradeFlag[] {
  return []
}

// A "system" trade is one that followed (or attempted to follow) the 5-setup
// playbook. F-graded trades are off-system (discipline lapses) and should be
// excluded from any stat that measures the system's performance — win rate,
// expectancy, by-setup, by-time-window. They are still included in raw P&L
// because the money was real.
export function isSystemTrade(trade: Trade): boolean {
  return trade.grade !== 'F'
}
