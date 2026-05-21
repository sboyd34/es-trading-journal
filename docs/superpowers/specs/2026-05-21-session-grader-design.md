# Session Grader — Design Spec
**Date:** 2026-05-21
**Status:** Approved

---

## Problem

P&L is a lagging indicator of discipline. A trader can have a great P&L day while violating every rule, or a losing day while executing perfectly. The session grader separates discipline from outcome — giving a 0–100 score based purely on rule compliance, saved per day so trends become visible.

---

## Scope

- New dashboard card showing today's discipline score
- Pure scoring engine (client-side, no API)
- Auto-save to `daily_sessions` on dashboard load when today's trades exist
- DB migration adding two columns to `daily_sessions`
- Types update for `DailySession`

---

## Architecture

### New file: `lib/session-grader.ts`
Pure function. No side effects. No DB calls.

```ts
interface DisciplineBreakdown {
  setup: number    // 0–25
  emotion: number  // 0–25
  prep: number     // 0–25
  grade: number    // 0–25
}

interface DisciplineScore {
  score: number              // 0–100 (sum of breakdown)
  breakdown: DisciplineBreakdown
}

function computeDisciplineScore(trades: Trade[], session: DailySession | null): DisciplineScore
```

### New file: `components/dashboard/DisciplineScoreCard.tsx`
Dashboard card component.

**Props:** `trades: Trade[]`, `session: DailySession | null`, `userId: string`, `date: string` (today's date in `YYYY-MM-DD` format — needed for the upsert)

**Behavior:**
- Returns `null` if no trades for today (silent-when-clean)
- Calls `computeDisciplineScore` via `useMemo`
- `useEffect` auto-saves score + breakdown to `daily_sessions` via Supabase upsert when score changes
- No loading state — save is silent background operation

**UI:** Score ring (SVG circle) with score number centered, label below, 2×2 icon grid underneath showing each dimension's sub-score.

### Modified file: `app/(app)/dashboard/DashboardClient.tsx`
Mount `<DisciplineScoreCard trades={todayTrades} session={session} />` alongside existing cards. `todayTrades` and `session` are already loaded in this component.

### New file: `supabase/add_discipline_score.sql`
```sql
ALTER TABLE daily_sessions
  ADD COLUMN IF NOT EXISTS discipline_score int CHECK (discipline_score >= 0 AND discipline_score <= 100),
  ADD COLUMN IF NOT EXISTS discipline_breakdown jsonb;
```

### Modified file: `types/index.ts`
Add to `DailySession`:
```ts
discipline_score: number | null
discipline_breakdown: DisciplineBreakdown | null
```

Add new exported interface:
```ts
export interface DisciplineBreakdown {
  setup: number
  emotion: number
  prep: number
  grade: number
}
```

---

## Scoring Formula

Each dimension is worth 25 points. Total = 0–100. All results are `Math.round`.

### 1. Setup compliance (25 pts)
- F-grade trades are off-system discipline lapses
- `score = Math.round((nonFTrades / totalTrades) * 25)`
- Edge case: 0 trades → 25 (no violations to penalize)

### 2. Emotional discipline (25 pts)
- Emotional moods: `FOMO`, `fomo`, `revenge`, `anxious`, `overconfident`
- `score = Math.round(((totalTrades - emotionalTrades) / totalTrades) * 25)`
- Edge case: 0 trades → 25

### 3. Pre-market prep (25 pts)
- `session?.checklist_passed === true → 25`
- `session?.checklist_passed === false → 0`
- `session === null or checklist_passed === null → 0` (no prep = no points)

### 4. Trade grade quality (25 pts)
- Count trades graded A or B out of all trades that have a grade (not null)
- `score = Math.round((abTrades / gradedTrades) * 25)`
- Edge case: 0 graded trades → 25

---

## UI

### Score ring
- SVG circle: full ring = 100, partial ring = score/100
- Score number centered inside ring
- Color: `score >= 90 → emerald`, `score >= 70 → amber`, `score < 70 → red`
- Label below ring: "Good session" (≥90) / "Solid" (≥70) / "Needs work" (<70)

### 2×2 icon grid
Four cells — Setup, Emotion, Prep, Grade — each showing:
- Icon: ✅ (full 25), ⚠️ (partial), ❌ (0)
- Sub-score: `X/25`
- Color matches score (emerald / amber / red)

### Card header
- Title: "Discipline Score"
- Subtitle: "Today · auto-saved"

---

## Data Flow

```
DashboardClient.tsx
  todayTrades, session (already loaded)
    └─> <DisciplineScoreCard trades={todayTrades} session={session} userId={userId} date={todayDate} />
          useMemo → computeDisciplineScore(trades, session)
            └─> { score, breakdown }
          useEffect (on score change, if trades.length > 0)
            └─> supabase.from('daily_sessions').upsert({ date, discipline_score, discipline_breakdown })
```

---

## Constraints

- No new API routes — scoring is pure client-side math
- Save only when `trades.length > 0` — no upsert on empty days
- Card returns `null` when no trades today (silent-when-clean convention)
- `DisciplineBreakdown` interface exported from `types/index.ts` so both `lib/session-grader.ts` and `DisciplineScoreCard.tsx` share the same type
- Type-check gate: `npx tsc --noEmit` must pass before shipping
- Migration must be run in Supabase dashboard before deploying
