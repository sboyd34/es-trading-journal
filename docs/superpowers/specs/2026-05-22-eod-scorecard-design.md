# EOD Scorecard — Design Spec
**Date:** 2026-05-22
**Status:** Approved

---

## Problem

The `daily_sessions` table has `discipline_score`, `discipline_breakdown`, `end_of_day_summary`, `emotion_score`, and `notes` columns that feed the weekly AI review. There is no UI to fill any of them out. The weekly review's discipline trend chart is always empty because nothing writes the scores.

---

## Scope

- New `'eod'` tab on the Journal page (alongside "Trade Log", "Import CSV", "Timeline")
- New `EodScorecard` component — self-contained, manages its own `daily_sessions` queries
- Date navigator (prev/next through dates that have trades, same pattern as Timeline)
- Day stats header (read-only: trade count, net P&L, win/loss from existing `trades` prop)
- Discipline scorecard: 4 sliders (0–25 each), auto-summed total
- AI session summary: "Generate" button calls existing `/api/claude/daily-summary`, populates 7 editable fields
- Emotion rating (1–10 button row) + free-text notes
- Single Save button upserts all fields to `daily_sessions`
- No new API routes, no new DB columns, no new npm dependencies

---

## Architecture

### Modified file: `app/(app)/journal/page.tsx`

Add `'eod'` to the `Tab` type:
```ts
type Tab = 'log' | 'import' | 'timeline' | 'eod'
```

Add an "EOD" tab button in the tab bar (same styling as existing tabs). Import and render `EodScorecard` when active:

```tsx
import EodScorecard from '@/components/journal/EodScorecard'

// In tab bar:
<button
  onClick={() => setTab('eod')}
  className={cn(
    'px-5 py-2 rounded-lg text-sm font-medium transition',
    tab === 'eod' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
  )}
>
  EOD
</button>

// Conditional render (before modals):
{tab === 'eod' && (
  <EodScorecard
    trades={trades}
    defaultDate={
      trades.length > 0
        ? [...trades].sort((a, b) => b.date.localeCompare(a.date))[0].date
        : undefined
    }
  />
)}
```

### New file: `components/journal/EodScorecard.tsx`

Client component. Props:

```ts
interface Props {
  trades: Trade[]
  defaultDate?: string
}
```

**Internal state:**
- `selectedDate: string` — initialized from `defaultDate`, falls back to today
- `setup: number` — slider value 0–25, initialized from loaded session
- `emotion: number` — slider value 0–25
- `prep: number` — slider value 0–25
- `gradeAdherence: number` — slider value 0–25
- `summary: EndOfDaySummary | null` — the 7-field summary object
- `emotionScore: number | null` — 1–10
- `notes: string` — free text
- `generatingSummary: boolean` — loading state for AI generation
- `saving: boolean` — loading state for save
- `existingSessionId: string | null` — id of loaded session row (for upsert targeting)

**`useMemo` — `tradingDates`:** Same pattern as `SessionTimeline` — sorted unique list of dates with trades, used by the navigator.

**`useMemo` — `dayStats`:** Filters `trades` to `selectedDate`, computes trade count, net P&L, win count, loss count.

**`useEffect` on `selectedDate`:** Fetches the `daily_sessions` row for the selected date. Pre-populates all state fields if a record exists. Sets `existingSessionId`.

---

## Components

### Date Navigator

```
[ ‹ ]   May 21, 2026   [ › ]
```

Same pattern as `SessionTimeline` — steps through `tradingDates`, no "Today" button needed here.

### Day Stats Header (read-only)

```
3 trades   +$312.50   2W / 1L
```

Emerald if net P&L positive, red if negative. Rendered from `dayStats` useMemo. If selected date has no trades, show "No trades on this date — you can still log a scorecard."

### Discipline Scorecard

Four labeled sliders in a 2×2 grid. Each 0–25. Labels:
- **Setup Quality** — Did you wait for a valid setup from the priority list?
- **Emotional Control** — Were you calm, flat, non-reactive throughout?
- **Preparation** — Did you complete pre-market prep and know your plan?
- **Grade Adherence** — Did your trade grades reflect honest self-assessment?

Below the sliders: auto-computed total displayed as `{total} / 100` with color coding:
- ≥ 85: `text-emerald-400`
- ≥ 70: `text-amber-400`
- < 70: `text-red-400`

### Session Summary

A "Generate AI Summary" button. On click:
1. Sets `generatingSummary = true`
2. `POST /api/claude/daily-summary` with `{ date: selectedDate }`
3. On success: populate the 7 text fields from the response's `summary` object
4. On error: `toast.error(...)`

Seven editable `<textarea>` fields (one per `EndOfDaySummary` key):
- What happened
- Trades review
- Emotional state
- Mistakes
- Wins
- Lesson
- Tomorrow's focus

Each field is pre-populated if a summary exists in the loaded session. The "Generate" button label changes to "Regenerate" if a summary is already present.

### Emotion & Notes

- Emotion score: a row of 10 buttons labeled 1–10. Selected button highlighted blue. Null = none selected.
- Notes: `<textarea>` for free text.

### Save Button

Single "Save Scorecard" button at the bottom. On click:
1. Sets `saving = true`
2. Upserts `daily_sessions` row for `(user_id, date)` with all current state:
   - `discipline_score`: sum of four slider values
   - `discipline_breakdown`: `{ setup, emotion, prep, grade: gradeAdherence }`
   - `end_of_day_summary`: current summary state (null if not generated/filled)
   - `emotion_score`: current emotionScore (null if not selected)
   - `notes`: current notes string
3. Sets `existingSessionId` from returned row id
4. `toast.success('Scorecard saved')`

**Silent-when-clean:** If `trades.length === 0`, render nothing (no trades loaded yet).

---

## Data Flow

```
JournalPage (loads all trades once)
  └─> EodScorecard
        ├─> tradingDates (useMemo — unique sorted dates)
        ├─> dayStats (useMemo — filter to selectedDate)
        ├─> useEffect(selectedDate) → fetch daily_sessions row → pre-populate state
        ├─> Discipline sliders → local state
        ├─> "Generate" button → POST /api/claude/daily-summary → populate summary state
        └─> "Save" button → UPSERT daily_sessions
```

---

## API: `/api/claude/daily-summary`

Already exists. Accepts `POST { date: "YYYY-MM-DD" }`. Requires cookie auth. Returns `{ summary: EndOfDaySummary }` on success. The component calls this as-is — no changes to the route needed.

---

## Constraints

- No new API routes — uses existing `/api/claude/daily-summary`
- No new DB columns — all fields already exist on `daily_sessions`
- No new npm dependencies
- Silent-when-clean: returns null when `trades.length === 0`
- Pre-populates from existing session record on date change
- Saving is idempotent — repeated saves upsert, never duplicate
