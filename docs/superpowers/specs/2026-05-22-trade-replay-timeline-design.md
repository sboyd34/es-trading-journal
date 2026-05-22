# Trade Replay Timeline — Design Spec
**Date:** 2026-05-22
**Status:** Approved

---

## Problem

The journal log shows trades as a flat list. There's no way to see the shape of a trading session — when entries happened relative to each other, how P&L accumulated through the day, or where discipline broke down. A timeline view makes session patterns immediately visible without digging through individual trade rows.

---

## Scope

- New "Timeline" tab on the Journal page (alongside existing "Log" and "Import")
- Date navigator (prev/next arrows, date display, "Today" button) that skips days with no trades
- Stacked visualization: running P&L curve on top, trade track below, sharing a common time axis
- Clicking any trade bar opens the existing annotation modal (same flow as the log tab)
- No new API routes, no new dependencies, no new Supabase queries

---

## Architecture

### Modified file: `app/(app)/journal/page.tsx`

Add `'timeline'` to the `Tab` type:
```ts
type Tab = 'log' | 'import' | 'timeline'
```

Add a "Timeline" tab button in the tab bar (same styling as "Log" and "Import"). When the timeline tab is active, render:

```tsx
<SessionTimeline
  trades={trades}
  onAnnotate={(trade) => setChecklistTrade(trade)}
  defaultDate={trades.length > 0 ? [...trades].sort((a, b) => b.date.localeCompare(a.date))[0].date : undefined}
/>
```

`trades` is the existing state already loaded by the page. `onAnnotate` reuses the existing `setChecklistTrade` setter so the Five Word Gate + annotation form flow is identical to the log tab.

### New file: `components/journal/SessionTimeline.tsx`

Client component. Props:

```ts
interface Props {
  trades: Trade[]
  onAnnotate: (trade: Trade) => void
  defaultDate?: string
}
```

**Internal state:**
- `selectedDate: string` — initialized from `defaultDate`, falls back to today

**`useMemo` — `dayData`:** Filters `trades` to `selectedDate`, sorts by `entry_time`, computes cumulative P&L at each entry point, and maps each trade's `entry_time` / `exit_time` to a CT-minute position for track layout.

```ts
const dayData = useMemo(() => {
  const day = trades
    .filter((t) => t.date === selectedDate)
    .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())

  let cumulative = 0
  const points = day.map((t) => {
    cumulative += t.net_pnl
    return { ...t, cumulative: Math.round(cumulative * 100) / 100 }
  })

  return points
}, [trades, selectedDate])
```

**`useMemo` — `tradingDates`:** Sorted ascending unique list of dates that have trades, used by the navigator to skip empty days (prev = earlier date, next = later date).

**Silent-when-clean:** If `trades.length === 0`, render nothing. If the selected date has no trades, show a minimal empty state: "No trades on this date."

---

## Components

### Date Navigator

```
[ ‹ ]   May 21, 2026   [ › ]   [ Today ]
```

- `‹` / `›` arrows step through `tradingDates` — skips dates with no trades
- "Today" jumps to today's date if it exists in `tradingDates`, otherwise disabled
- Same visual pattern as the weekly review week navigator

### P&L Curve

Recharts `AreaChart` (same library as `EquityCurve`):

- **X-axis:** CT time labels derived from `entry_time` (e.g. `08:47`, `09:12`). Domain spans from the earliest entry to the latest exit with a small buffer.
- **Y-axis:** Cumulative P&L in dollars. Reference line at `y=0` (dashed, gray).
- **Data points:** One point per trade at `entry_time`, value = cumulative P&L after that trade closed.
- **Dot styling:** Emerald if `net_pnl > 0`, red if `net_pnl <= 0`. Radius 5, visible on the line.
- **Area fill:** Emerald gradient above $0, red gradient below — same `defs`/`linearGradient` pattern used in `EquityCurve.tsx`.
- **Height:** ~180px.

### Trade Track

Positioned directly below the P&L curve, sharing the same time axis width so entry dots align vertically above their bars.

**Layout:** A single horizontal row. Each trade rendered as an absolutely-positioned div:

```
left  = (entryMinsCT - sessionStartMins) / sessionDurationMins * 100%
width = (exitMinsCT - entryMinsCT) / sessionDurationMins * 100%
```

`sessionStartMins` = CT minutes of the earliest entry minus a small left buffer (e.g. 5 min).
`sessionDurationMins` = total span from session start to latest exit plus buffer.

**Minimum bar width:** 2% of track width so very short scalp trades are still visible and clickable.

**Bar appearance:**
- Background: `bg-emerald-500/20 border-emerald-500/40` for winners, `bg-red-500/20 border-red-500/40` for losers, `bg-gray-700/40 border-gray-600/40` for ungraded/scratch
- Inside text (if bar is wide enough): `{setup_tag} · {grade} · {formatCurrency(net_pnl)}`
- Truncated with `overflow-hidden text-ellipsis` if bar is narrow
- On click: calls `onAnnotate(trade)`

**Tooltip on hover:** Shows trade number, setup, grade, P&L, entry/exit time CT — always visible regardless of bar width.

---

## Data Flow

```
JournalPage (loads all trades once)
  └─> SessionTimeline
        └─> dayData (useMemo — filter + sort + cumulate)
              └─> P&L Curve (recharts AreaChart)
              └─> Trade Track (div layout)
                    └─> click → onAnnotate(trade)
                          └─> JournalPage.setChecklistTrade(trade)
                                └─> FiveWordGateModal → TradeAnnotationForm
```

---

## CT Time Conversion

`entry_time` and `exit_time` are stored as UTC ISO strings. Convert to CT minutes:

```ts
function toCtMins(iso: string): number {
  const d = new Date(iso)
  const ctStr = d.toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const [h, m] = ctStr.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}
```

---

## Constraints

- No new Supabase queries — uses `trades` array already loaded by `JournalPage`
- No new npm dependencies — uses recharts (already installed) for the curve
- Silent-when-clean: component returns null when `trades.length === 0`
- Minimum bar width ensures short trades remain clickable
- Annotation flow is identical to the log tab — no new modal code needed
- `toCtMins` handles the daylight saving ambiguity correctly because `toLocaleTimeString` with `timeZone: 'America/Chicago'` always returns the wall-clock CT time
