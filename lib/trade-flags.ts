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

export type WindowStatus = 'building' | 'primary' | 'continuation' | 'late' | 'secondary' | 'dead_zone' | 'closed' | 'unknown'

// Classify a CT minute count into a named trading window.
export function classifyWindow(mins: number): WindowStatus {
  if (mins >= 510 && mins < 525) return 'building'      // 08:30–08:45 OR building
  if (mins >= 525 && mins <= 570) return 'primary'       // 08:45–09:30 ORB
  if (mins > 570 && mins <= 630) return 'continuation'  // 09:30–10:30
  if (mins > 630 && mins <= 660) return 'late'           // 10:30–11:00 A+ only
  if (mins > 660 && mins < 750) return 'dead_zone'       // 11:00–12:30 dead zone
  if (mins >= 750 && mins <= 840) return 'secondary'     // 12:30–14:00 conditional
  if (mins > 840) return 'closed'                        // after 14:00
  return 'unknown'
}

// Whether a window is considered "approved" for a trade entry.
const APPROVED_WINDOWS: WindowStatus[] = ['primary', 'continuation', 'late', 'secondary']

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
