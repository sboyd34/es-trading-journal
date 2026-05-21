# F Grade — Off-System Trade Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `F` grade representing an off-system trade. F collapses the annotation form to two textareas, is excluded from system performance stats, and surfaces as "Off-system damage" on the dashboard plus a "Discipline" section on the weekly review.

**Architecture:** F is stored as `grade = 'F'` in the existing `trades.grade` column — no new column. The annotation form has a boolean toggle that switches the form into F-mode (hide most fields, relabel two textareas, force `setup_tag = null` on save). A shared `isSystemTrade` helper gates "system" stat computations. A new `OffSystemDamageCard` on the dashboard and a "Discipline" section on the weekly-review surface the cost of F trades.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind, Supabase Postgres.

**Codebase conventions (apply to every task):**
- `useMemo`-first for derived state in client components.
- Silent-when-clean: components return `null` instead of empty placeholders.
- No tests in this codebase — verification is `npx tsc --noEmit` plus manual browser check.
- Commit message format: `<Area>: <imperative phrase>`. Body explains *why*, not *what*. Trailer: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- Atomic commits — one concern per commit.

**Working directory note:** All commands assume the working directory is `/Users/shawndeeboyd/es-trading-journal`. If your shell sits elsewhere, prepend `cd /Users/shawndeeboyd/es-trading-journal && ...` or use `git -C /Users/shawndeeboyd/es-trading-journal ...`.

---

## Task 1: Migration — allow F in `trades.grade` CHECK

**Files:**
- Create: `supabase/add_f_grade.sql`

**Why:** The Postgres CHECK constraint on `trades.grade` is currently `IN ('A', 'B', 'C')`. Any attempt to save `grade = 'F'` will be rejected. This migration drops the old constraint and adds the new one.

- [ ] **Step 1: Create the migration file**

Write `supabase/add_f_grade.sql` with this exact content:

```sql
-- Add F grade for off-system trades.
-- F means: trade was not one of the 5 system setups (off-playbook discipline lapse).
-- F is distinct from C (which is a rule violation within the system).

ALTER TABLE trades DROP CONSTRAINT IF EXISTS trades_grade_check;

ALTER TABLE trades
  ADD CONSTRAINT trades_grade_check
  CHECK (grade IN ('A', 'B', 'C', 'F'));
```

- [ ] **Step 2: Apply the migration manually**

Per the project's migration workflow (no automated tracker): open the Supabase dashboard → SQL editor → paste the file contents → run.

Expected: `ALTER TABLE` succeeds twice. No rows affected.

- [ ] **Step 3: Verify the new constraint**

In the same Supabase SQL editor, run:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'trades'::regclass AND conname = 'trades_grade_check';
```

Expected output: `CHECK ((grade = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'F'::text])))`

- [ ] **Step 4: Commit**

```bash
git add supabase/add_f_grade.sql
git commit -m "$(cat <<'EOF'
Schema: allow F in trades.grade CHECK

F marks off-system trades (off the 5-setup playbook). Distinct from
C (rule violation within the system). Run this migration in the
Supabase SQL editor before the type/form changes ship.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend `Trade['grade']` union to include `'F'`

**Files:**
- Modify: `types/index.ts:31`

**Why:** TypeScript currently rejects `grade = 'F'`. We need the union to mirror the Postgres CHECK. Only the main `Trade` interface (line 31) changes — `BacktestTrade` (line 154) and `BlindBacktestTrade` ai_grade/self_grade (lines 260, 262) stay A/B/C; F is for the live trade journal only.

- [ ] **Step 1: Edit `types/index.ts:31`**

Change line 31 from:

```ts
  grade: 'A' | 'B' | 'C' | null
```

to:

```ts
  grade: 'A' | 'B' | 'C' | 'F' | null
```

Leave lines 154, 260, 262 unchanged.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: passes (the existing `gradeColors` map in `TradeAnnotationForm.tsx` is typed as `Record<string, string>`, so the wider union won't break it).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "$(cat <<'EOF'
Types: extend Trade.grade union to include F

Mirrors the new Postgres CHECK constraint. Backtest tables stay A/B/C
since F is for the live trade journal only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `isSystemTrade` helper

**Files:**
- Modify: `lib/trade-flags.ts` (append to existing file)

**Why:** Centralize the "exclude F from system stats" rule in one helper so every `useMemo` that computes performance stats gates on the same predicate. Avoids the inevitable "we forgot to filter F somewhere" bug.

- [ ] **Step 1: Append to `lib/trade-flags.ts`**

Add this block to the end of the file (after the existing `computeTradeFlags` function, around line 121):

```ts

// A "system" trade is one that followed (or attempted to follow) the 5-setup
// playbook. F-graded trades are off-system (discipline lapses) and should be
// excluded from any stat that measures the system's performance — win rate,
// expectancy, by-setup, by-time-window. They are still included in raw P&L
// because the money was real.
export function isSystemTrade(trade: Trade): boolean {
  return trade.grade !== 'F'
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/trade-flags.ts
git commit -m "$(cat <<'EOF'
Trade flags: add isSystemTrade helper

Single predicate for gating "system" performance stats. F-graded trades
are excluded from win rate / expectancy / by-setup but still counted in
raw P&L because the money was real.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Handle `'F'` in `getGradeColor`

**Files:**
- Modify: `lib/utils.ts:41-46`

**Why:** Wherever the journal/trade list renders a grade badge, it calls `getGradeColor(grade)` to pick the Tailwind classes. Without an F case, F badges would fall through to the default gray — we want a distinct black-on-white treatment.

- [ ] **Step 1: Edit `lib/utils.ts:41-46`**

Replace the existing function:

```ts
export function getGradeColor(grade: string | null): string {
  if (grade === 'A') return 'text-emerald-400 bg-emerald-400/10'
  if (grade === 'B') return 'text-yellow-400 bg-yellow-400/10'
  if (grade === 'C') return 'text-red-400 bg-red-400/10'
  return 'text-gray-400 bg-gray-400/10'
}
```

with:

```ts
export function getGradeColor(grade: string | null): string {
  if (grade === 'A') return 'text-emerald-400 bg-emerald-400/10'
  if (grade === 'B') return 'text-yellow-400 bg-yellow-400/10'
  if (grade === 'C') return 'text-red-400 bg-red-400/10'
  if (grade === 'F') return 'text-white bg-black border border-gray-600'
  return 'text-gray-400 bg-gray-400/10'
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/utils.ts
git commit -m "$(cat <<'EOF'
Utils: add F grade badge color

Black background with white text and a subtle border — visually
distinct from C's red so the category jump (off-system vs.
rule-violation-within-system) reads at a glance.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add off-system toggle to `TradeAnnotationForm`

**Files:**
- Modify: `components/journal/TradeAnnotationForm.tsx`

**Why:** The form is where every trade gets annotated. Adding F as a separated toggle (not a fourth grade button) reinforces the conceptual distinction: F isn't a worse grade, it's a *flag* that overrides the grade. When toggled on, the form collapses to just the two textareas the user cares about for off-system trades.

This is the biggest task in the plan — multiple steps below.

- [ ] **Step 1: Add `offSystem` state and initialize from `trade.grade`**

In `TradeAnnotationForm.tsx`, find the state block starting at line 40:

```ts
  const [mood, setMood] = useState<Trade['mood']>(trade.mood)
  const [grade, setGrade] = useState<Trade['grade']>(trade.grade)
```

Immediately after the `grade` line, add:

```ts
  const [offSystem, setOffSystem] = useState<boolean>(trade.grade === 'F')
```

- [ ] **Step 2: Add the toggle UI below the existing grade rubric block**

Find the closing `</div>` of the grade section, around line 345 (right after the `{showRubric && (...)}` block, before the `{/* Instrument + Setup tag row */}` comment).

The existing structure ends like this:

```tsx
        {showRubric && (
          <div className="mt-2 rounded-lg border border-gray-700/60 bg-gray-900/50 divide-y divide-gray-700/40 text-xs">
            {/* A/B/C rubric rows */}
          </div>
        )}
      </div>

      {/* Instrument + Setup tag row */}
```

Insert a new block between the closing `</div>` of the grade section and the `{/* Instrument + Setup tag row */}` comment:

```tsx
      </div>

      {/* Off-system toggle — F flag */}
      <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={offSystem}
            onChange={(e) => {
              const next = e.target.checked
              setOffSystem(next)
              // When toggling off on an existing F trade, clear the grade so the
              // user must actively re-pick A/B/C. Spec: "switching toggle back
              // to off clears grade (returns to ungraded)."
              if (!next && grade === 'F') setGrade(null)
            }}
            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-white focus:ring-1 focus:ring-gray-400"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-200">Off-system trade (F)</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Use when the trade wasn't one of the 5 setups — a discipline lapse, not a graded execution.
            </p>
          </div>
        </label>
      </div>

      {/* Instrument + Setup tag row */}
```

- [ ] **Step 3: Conditionally hide A/B/C grade row + rubric when toggle is on**

The grade section starts around line 301. Wrap the entire grade block in `{!offSystem && (...)}`.

Find the existing structure:

```tsx
      {/* Grade selector + rubric */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">Grade</label>
          {/* ... rubric toggle button ... */}
        </div>
        <div className="flex gap-3 mb-2">
          {GRADES.map((g) => (
            {/* ... grade buttons ... */}
          ))}
        </div>
        {showRubric && (
          {/* ... rubric content ... */}
        )}
      </div>
```

Change the wrapping `<div>` (the one with the `/* Grade selector + rubric */` comment) to render conditionally:

```tsx
      {/* Grade selector + rubric — hidden when off-system */}
      {!offSystem && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-300">Grade</label>
            {/* ... existing rubric toggle button ... */}
          </div>
          <div className="flex gap-3 mb-2">
            {GRADES.map((g) => (
              {/* ... existing grade buttons ... */}
            ))}
          </div>
          {showRubric && (
            {/* ... existing rubric content ... */}
          )}
        </div>
      )}
```

(Re-indent the existing inner content by one level. Keep all inner JSX exactly as it was.)

- [ ] **Step 4: Conditionally hide Mood, Setup Tag row, MAE/MFE/SL/Target row, Tags, Chart Screenshots when toggle is on**

These five blocks each currently render unconditionally. Wrap each in `{!offSystem && (...)}`:

1. **Mood selector** (around line 279): wrap the entire `<div>` containing `MOODS.map(...)` in `{!offSystem && ( ... )}`.

2. **Instrument + Setup tag grid** (around line 348): wrap the entire `<div className="grid grid-cols-3 gap-3">...</div>` block in `{!offSystem && ( ... )}`. (Instrument actually stays visible — but it's bundled with Setup Tag in this 3-col grid. For simplicity, hide the whole row; the Instrument field is also represented by the Apex account context. If you want Instrument to stay visible, split the grid into a 1-col instrument row + 1-col setup row and conditionally hide only the setup row. Either is acceptable; the spec accepts hiding the whole row.)

3. **MAE / MFE / SL / Target grid** (around line 397): wrap `<div className="grid grid-cols-2 gap-3">...</div>` in `{!offSystem && ( ... )}`.

4. **Tags input** (around line 536): wrap the `<div>` containing the Tags `<input>` in `{!offSystem && ( ... )}`.

5. **Chart Screenshots block** (around line 547): wrap the `<div>` containing the `<Camera>` icon header and the two `ImageUploadSlot`s in `{!offSystem && ( ... )}`.

The Apex Account block (around line 378), News articles block (around line 500), Notes block, and Reflection block all stay visible. (News block is already silent-when-clean.)

- [ ] **Step 5: Relabel Notes and Reflection textareas when toggle is on**

The Notes block starts around line 444. Find the existing label and textarea:

```tsx
          <label className="text-sm font-medium text-gray-300">Notes</label>
```

```tsx
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="What was the trade thesis? Market context?"
          className="..."
        />
```

Change the label text and placeholder to be conditional:

```tsx
          <label className="text-sm font-medium text-gray-300">
            {offSystem ? 'What made you enter this trade?' : 'Notes'}
          </label>
```

```tsx
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={offSystem ? 3 : 2}
          placeholder={
            offSystem
              ? 'Boredom, FOMO, news pop, pattern that looked good but wasn\'t on the list…'
              : 'What was the trade thesis? Market context?'
          }
          className="..."
        />
```

The Reflection block starts around line 488. Find:

```tsx
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Post-Trade Reflection</label>
        <textarea
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          rows={3}
          placeholder="What did you do well? What would you do differently?"
          className="..."
        />
```

Change to:

```tsx
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          {offSystem ? 'Post-trade notes — what did you learn?' : 'Post-Trade Reflection'}
        </label>
        <textarea
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          rows={3}
          placeholder={
            offSystem
              ? 'What was the cost? What would have stopped you?'
              : 'What did you do well? What would you do differently?'
          }
          className="..."
        />
```

- [ ] **Step 6: Update save logic to write `grade = 'F'` and clear `setup_tag` when toggle is on**

The `handleSave` function starts at line 184. Find the body block (line 190-212):

```ts
        body: JSON.stringify({
          mood: mood || null,
          grade: grade || null,
          setup_tag: setupTag || null,
          mae: mae ? parseFloat(mae) : null,
          {/* ... etc ... */}
        }),
```

Change the first three fields to be off-system-aware:

```ts
        body: JSON.stringify({
          mood: offSystem ? null : (mood || null),
          grade: offSystem ? 'F' : (grade || null),
          setup_tag: offSystem ? null : (setupTag || null),
          mae: offSystem ? null : (mae ? parseFloat(mae) : null),
          mfe: offSystem ? null : (mfe ? parseFloat(mfe) : null),
          stop_loss: offSystem ? null : (stopLoss ? parseFloat(stopLoss) : null),
          target: offSystem ? null : (target ? parseFloat(target) : null),
          notes: notes || null,
          reflection: reflection || null,
          tags: offSystem ? [] : (tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : []),
          instrument,
          account_id: accountId,
          entry_chart_url: offSystem ? null : (entryChart ? entryChart.split('?')[0] : null),
          exit_chart_url: offSystem ? null : (exitChart ? exitChart.split('?')[0] : null),
          ...(gateAnswers && !offSystem && {
            trade_bias: gateAnswers.bias,
            trade_setup: gateAnswers.setup,
            trade_trigger: gateAnswers.trigger,
            trade_location: gateAnswers.location,
            trade_risk: gateAnswers.risk,
          }),
        }),
```

Rationale: when `offSystem = true`, every "system" field (mood, setup tag, MAE/MFE, stop/target, tags, charts, gate answers) is force-cleared so the database row is consistent with the F flag. Notes, reflection, instrument, and account_id are preserved because the user typed them or they're needed for P&L attribution.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 8: Manual UI check**

Start the dev server and verify each branch:

```bash
npm run dev
```

In a browser:

1. Open the journal, click an existing trade to open the annotation form.
2. **Default state (toggle off):** confirm the form looks identical to before — mood, A/B/C grade row, instrument+setup, MAE/MFE/SL/target, tags, charts all visible.
3. **Toggle on:** click the "Off-system trade (F)" checkbox. Confirm mood, grade row, setup tag row, MAE/MFE row, tags input, and chart screenshots all disappear. The Notes label changes to "What made you enter this trade?" The Reflection label changes to "Post-trade notes — what did you learn?"
4. **Toggle off again:** confirm all hidden fields reappear with any previously-entered values still in place.
5. **Save F:** toggle on, type "Bored, no setup" into the first textarea, "Cost $100, would have helped to step away from the screen" into the second, click Save Annotation. Confirm no error toast.
6. **Re-open the saved trade:** confirm the toggle initializes to `on`, the textareas show the saved text.
7. **Toggle back to off on a saved F trade:** confirm the grade row reappears and `grade` is no longer F; saving without picking A/B/C leaves the trade ungraded.

- [ ] **Step 9: Commit**

```bash
git add components/journal/TradeAnnotationForm.tsx
git commit -m "$(cat <<'EOF'
Form: add off-system toggle for F-graded trades

F is a flag, not a fourth grade — toggling it on collapses the form
to just two textareas (what made you enter / post-trade notes) and
force-clears every system field on save. Reinforces the conceptual
distinction: off-system isn't "worse than C," it's a different
category that overrides the grade.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Filter F out of dashboard "system" stats

**Files:**
- Modify: `app/(app)/dashboard/DashboardClient.tsx:28-84`

**Why:** The current `computeStats` reduces over every trade. With F now possible, win rate and profit factor would absorb noise from trades you've explicitly flagged as outside the system. Split the reductions: "system trades only" feeds win-rate/avg-win/avg-loss/profit-factor/streak; "all trades" still feeds total P&L (the money was real).

- [ ] **Step 1: Import `isSystemTrade`**

In `app/(app)/dashboard/DashboardClient.tsx`, find the existing import lines at the top:

```ts
import { Trade, RiskRules, DailySession, DashboardStats } from '@/types'
```

Add a new import below it:

```ts
import { isSystemTrade } from '@/lib/trade-flags'
```

- [ ] **Step 2: Rewrite `computeStats` to split system vs all trades**

Replace the entire `computeStats` function (lines 28-84) with:

```ts
function computeStats(trades: Trade[], todayTrades: Trade[]): DashboardStats {
  // "System" trades drive win rate, expectancy, streak — F trades are excluded.
  // Raw P&L still includes everything because the money was real.
  const systemTrades = trades.filter(isSystemTrade)
  const todayPnL = todayTrades.reduce((s, t) => s + t.net_pnl, 0)
  const todayGrossPnL = todayTrades.reduce((s, t) => s + t.gross_pnl, 0)

  if (!trades.length) {
    return {
      totalPnL: 0,
      totalGrossPnL: 0,
      winRate: 0,
      totalTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      currentStreak: 0,
      todayPnL,
      todayGrossPnL,
    }
  }

  const totalPnL = trades.reduce((s, t) => s + t.net_pnl, 0)
  const totalGrossPnL = trades.reduce((s, t) => s + t.gross_pnl, 0)

  // System-only metrics
  const winners = systemTrades.filter((t) => t.net_pnl > 0)
  const losers = systemTrades.filter((t) => t.net_pnl <= 0)
  const winRate = systemTrades.length ? (winners.length / systemTrades.length) * 100 : 0
  const avgWin = winners.length ? winners.reduce((s, t) => s + t.net_pnl, 0) / winners.length : 0
  const avgLoss = losers.length ? Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0) / losers.length) : 0
  const grossWins = winners.reduce((s, t) => s + t.net_pnl, 0)
  const grossLosses = Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0))
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0

  // Streak runs over system trades only — an off-system loss shouldn't break a winning streak.
  const sorted = [...systemTrades].sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())
  let streak = 0
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1]
    const isWin = last.net_pnl > 0
    for (let i = sorted.length - 1; i >= 0; i--) {
      if ((sorted[i].net_pnl > 0) === isWin) {
        streak += isWin ? 1 : -1
      } else {
        break
      }
    }
  }

  return {
    totalPnL,
    totalGrossPnL,
    winRate,
    totalTrades: systemTrades.length,
    avgWin,
    avgLoss,
    profitFactor,
    currentStreak: streak,
    todayPnL,
    todayGrossPnL,
  }
}
```

Note: `totalTrades` is now system-only — it tracks the "real" system trade count, not the noise. If the user has 12 trades total and 2 are F, the dashboard shows "10 trades." The Off-System Damage card (Task 7-8) will show the 2 separately.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 4: Manual UI check**

Start the dev server. Open the dashboard with at least one A/B/C trade and one F trade saved (use the form from Task 5).

Verify:
1. The "Total Trades" stat card shows the system-only count (excludes F).
2. The "Win Rate" stat card excludes the F trade from the denominator.
3. The "Total P&L" stat card includes the F trade's P&L (it's real money).
4. Streak is computed over system trades only — an F-trade loss doesn't break a winning streak.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/dashboard/DashboardClient.tsx
git commit -m "$(cat <<'EOF'
Dashboard: exclude F trades from system performance stats

Win rate, expectancy, profit factor, and streak now run over
isSystemTrade(...) only. Total P&L still includes F because the
money was real — the split mirrors how a fund computes alpha vs.
tracking error.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Create `OffSystemDamageCard` component

**Files:**
- Create: `components/dashboard/OffSystemDamageCard.tsx`

**Why:** The "Off-system damage" surface is what makes the cost of discipline lapses impossible to ignore. Silent when there's no damage (per the silent-when-clean convention), but when F trades exist, it shows count, P&L damage, biggest single loss, and most recent timestamp.

- [ ] **Step 1: Create the component file**

Write `components/dashboard/OffSystemDamageCard.tsx` with this exact content:

```tsx
'use client'

import { useMemo } from 'react'
import { Trade } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'
import { AlertOctagon } from 'lucide-react'

interface OffSystemDamageCardProps {
  trades: Trade[]
}

// Returns true if trade.date falls in the current calendar month (CT not strictly necessary —
// trade.date is already a date-only string in local terms).
function inCurrentMonth(dateStr: string): boolean {
  const now = new Date()
  const [y, m] = dateStr.split('-').map(Number)
  return y === now.getFullYear() && m === now.getMonth() + 1
}

export default function OffSystemDamageCard({ trades }: OffSystemDamageCardProps) {
  const damage = useMemo(() => {
    const fTrades = trades.filter((t) => t.grade === 'F' && inCurrentMonth(t.date))
    if (fTrades.length === 0) return null

    const netPnL = fTrades.reduce((s, t) => s + t.net_pnl, 0)
    const sortedByLoss = [...fTrades].sort((a, b) => a.net_pnl - b.net_pnl)
    const biggestLoss = sortedByLoss[0]?.net_pnl ?? 0
    const sortedByTime = [...fTrades].sort(
      (a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime(),
    )
    const mostRecent = sortedByTime[0]

    return {
      count: fTrades.length,
      netPnL,
      biggestLoss,
      mostRecent,
    }
  }, [trades])

  // Silent-when-clean: render nothing when there are no F trades this month.
  if (!damage) return null

  return (
    <div className="bg-black/60 border border-gray-600 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertOctagon className="h-4 w-4 text-gray-300" />
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Off-system damage — month to date
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500">Trades</p>
          <p className="text-2xl font-bold text-white mt-0.5">{damage.count}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Net P&L</p>
          <p className={cn('text-2xl font-bold mt-0.5', damage.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {formatCurrency(damage.netPnL)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Biggest loss</p>
          <p className="text-2xl font-bold text-red-400 mt-0.5">{formatCurrency(damage.biggestLoss)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Most recent</p>
          <p className="text-sm text-gray-200 mt-1.5">
            {new Date(damage.mostRecent.entry_time).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
            <span className="text-gray-500"> · </span>
            <span className="text-gray-400">{damage.mostRecent.instrument}</span>
          </p>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/OffSystemDamageCard.tsx
git commit -m "$(cat <<'EOF'
Dashboard: add OffSystemDamageCard component

Surfaces month-to-date F trade count, net P&L damage, biggest single
loss, and most recent occurrence. Silent when zero F trades this
month, per the silent-when-clean convention. Black border treatment
matches the F badge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Mount `OffSystemDamageCard` on the dashboard

**Files:**
- Modify: `app/(app)/dashboard/DashboardClient.tsx`

**Why:** Component now exists — wire it in below the stats cards so the user sees damage right next to system performance.

- [ ] **Step 1: Import the card**

In `app/(app)/dashboard/DashboardClient.tsx`, find the existing dashboard component imports (around lines 5-19). Add this line in alphabetical order (after `MarketStateCard` or wherever fits):

```ts
import OffSystemDamageCard from '@/components/dashboard/OffSystemDamageCard'
```

- [ ] **Step 2: Render the card below `<StatsCards>`**

Find the existing line 141:

```tsx
      <StatsCards stats={stats} todayPnL={stats.todayPnL} todayGrossPnL={stats.todayGrossPnL} />
```

Add the new card immediately after it:

```tsx
      <StatsCards stats={stats} todayPnL={stats.todayPnL} todayGrossPnL={stats.todayGrossPnL} />

      {/* Off-system damage — silent when there are no F trades this month */}
      <OffSystemDamageCard trades={trades} />
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 4: Manual UI check**

Start the dev server. Open the dashboard.

Verify:
1. With **no F trades this month:** the card renders nothing — the dashboard layout is unchanged from before.
2. Use the form (Task 5) to mark a trade as off-system. Reload the dashboard.
3. **With ≥1 F trade this month:** the card appears with count, net P&L, biggest loss, and most recent date.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/dashboard/DashboardClient.tsx
git commit -m "$(cat <<'EOF'
Dashboard: mount OffSystemDamageCard below stats cards

Silent when no F trades this month so the layout is unchanged when
discipline is clean.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Weekly Review — "Discipline" section

**Files:**
- Modify: `app/(app)/weekly-review/page.tsx`

**Why:** The dashboard card creates daily behavior pressure. The weekly review surface is reflective — reading your own *reasons* back to yourself is the part that does behavioral work. Adding a Discipline section above the recap puts F trades front and center in the weekly review flow.

- [ ] **Step 1: Compute `weekFTrades` in a memo**

In `app/(app)/weekly-review/page.tsx`, find the existing `weekStats` useMemo (around lines 101-114).

Immediately after the closing `}, [weekTrades])` of `weekStats`, add a new memo:

```ts
  const weekFTrades = useMemo(() => {
    return weekTrades
      .filter((t) => t.grade === 'F')
      .sort((a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime())
  }, [weekTrades])

  const weekDamage = useMemo(() => {
    if (weekFTrades.length === 0) return null
    return {
      count: weekFTrades.length,
      netPnL: weekFTrades.reduce((s, t) => s + t.net_pnl, 0),
    }
  }, [weekFTrades])
```

- [ ] **Step 2: Render the Discipline section**

Find the JSX block where the page renders its content. Locate where the existing review summary or stats are rendered (after `weekStats` is consumed). You'll need to insert the new section above the existing recap.

A safe insertion point: just after the page header / week navigation but before any review-content blocks. Look for the first `<div className="space-y-4">` or similar container that wraps the body, and add this block as the first child:

```tsx
        {/* Discipline — F trades this week. Silent when zero. */}
        {weekDamage && (
          <section className="rounded-xl border border-gray-600 bg-black/40 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">
                Discipline — off-system trades this week
              </h2>
              <p className="text-sm text-gray-400">
                {weekDamage.count} trade{weekDamage.count === 1 ? '' : 's'} ·{' '}
                <span className={cn('font-semibold', weekDamage.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {formatCurrency(weekDamage.netPnL)}
                </span>
              </p>
            </div>
            <ul className="space-y-2">
              {weekFTrades.map((t) => (
                <li key={t.id} className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-400">
                      {new Date(t.entry_time).toLocaleString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      <span className="text-gray-600"> · </span>
                      <span className="text-gray-300">{t.instrument}</span>
                    </p>
                    <p className={cn('text-sm font-semibold', t.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {formatCurrency(t.net_pnl)}
                    </p>
                  </div>
                  {t.notes && (
                    <p className="text-sm text-gray-200 leading-snug">
                      <span className="text-gray-500">Reason: </span>
                      {t.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
```

This section uses `cn` and `formatCurrency` — both are already imported at the top of `weekly-review/page.tsx` (lines 6-7), so no new imports are needed for those. If the insertion site doesn't already have access to the `weekFTrades` and `weekDamage` consts, ensure they're in scope (they will be, since both useMemo blocks are at the top of the component).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 4: Manual UI check**

Open the weekly review page in the dev browser.

Verify:
1. **A week with no F trades:** the Discipline section is invisible — page renders as before.
2. **A week with ≥1 F trade:** the section appears above the recap with count, net P&L, and each F trade listed with its date, instrument, P&L, and "Reason" text from notes.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/weekly-review/page.tsx
git commit -m "$(cat <<'EOF'
Weekly Review: add Discipline section for F trades

Reads your own reasons back to you during the reflective surface
where the behavioral work actually happens. Silent when no F trades
in the selected week.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Add F to the Journal grade filter

**Files:**
- Modify: `app/(app)/journal/page.tsx`

**Why:** The journal page already filters trades by grade (line 116: `t.grade !== filterGrade`). The filter dropdown UI elsewhere on the page lists 'all', 'A', 'B', 'C'. Without adding 'F', the user can't filter to see only off-system trades — important for "show me everything I shouldn't have traded this month."

- [ ] **Step 1: Locate the filter dropdown UI**

In `app/(app)/journal/page.tsx`, search for the existing grade filter `<select>` or button group. Most likely uses `filterGrade` state and renders options for `'all' | 'A' | 'B' | 'C'`.

Run: `grep -n "filterGrade\|'A'.*'B'.*'C'" app/\(app\)/journal/page.tsx`

The output will show the state declaration and the filter UI. The state type is probably `useState<'all' | 'A' | 'B' | 'C'>('all')`.

- [ ] **Step 2: Widen the type and add the F option**

Change the state declaration from:

```ts
const [filterGrade, setFilterGrade] = useState<'all' | 'A' | 'B' | 'C'>('all')
```

to:

```ts
const [filterGrade, setFilterGrade] = useState<'all' | 'A' | 'B' | 'C' | 'F'>('all')
```

Find the filter UI (button group or dropdown). It will look something like:

```tsx
{(['all', 'A', 'B', 'C'] as const).map((g) => (
  <button key={g} onClick={() => setFilterGrade(g)} ...>
    {g === 'all' ? 'All' : g}
  </button>
))}
```

Change the array to include `'F'`:

```tsx
{(['all', 'A', 'B', 'C', 'F'] as const).map((g) => (
  <button key={g} onClick={() => setFilterGrade(g)} ...>
    {g === 'all' ? 'All' : g}
  </button>
))}
```

(If the existing code uses a `<select>` with `<option>` elements instead, add `<option value="F">F</option>` after the C option.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: passes.

- [ ] **Step 4: Manual UI check**

Open the journal page in the dev browser.

Verify:
1. The grade filter now has an F option visible.
2. Clicking F filters the trade list to F trades only.
3. F badges render in black-on-white (per Task 4) wherever the trade list shows grade.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/journal/page.tsx
git commit -m "$(cat <<'EOF'
Journal: add F to the grade filter

Lets the user pull up every off-system trade in one view — useful
for retrospective analysis of discipline lapses.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

After all 10 tasks are complete:

- [ ] **Run a clean type-check across the whole repo:**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Run the linter:**

```bash
npm run lint
```

Expected: zero new warnings introduced by this change.

- [ ] **Build sanity check:**

```bash
npm run build
```

Expected: build succeeds.

- [ ] **End-to-end manual flow:**

1. Create or annotate an A trade — confirm it grades normally and contributes to win rate.
2. Create or annotate a B trade.
3. Create or annotate a C trade.
4. Toggle on "Off-system" for a fourth trade — confirm form collapses, save succeeds with `grade = 'F'`.
5. Reload the dashboard:
   - Win rate excludes the F trade.
   - Total Trades shows 3 (system-only).
   - Total P&L includes all 4 trades.
   - Off-System Damage card shows 1 trade, the F's P&L, the F's biggest loss, the F's instrument and date.
6. Open the journal — F filter shows only the F trade; trade list shows the black F badge.
7. Open the weekly review for the week containing the F trade — Discipline section appears with the F trade listed and its reason text.

If anything diverges, fix it before declaring the feature done.
