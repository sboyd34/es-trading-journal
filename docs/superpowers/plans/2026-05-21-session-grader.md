# Session Grader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discipline Score card to the dashboard that auto-saves a 0–100 rule-compliance score (setup, emotion, prep, grade quality) to `daily_sessions` whenever today's trades are present.

**Architecture:** Pure scoring engine in `lib/session-grader.ts` with no side effects. `DisciplineScoreCard` component calls the engine via `useMemo`, auto-saves via `useEffect` + Supabase upsert, and returns `null` when no trades exist today (silent-when-clean). Two new columns on `daily_sessions` store the score and its breakdown.

**Tech Stack:** React (useMemo, useEffect), Supabase client-side upsert, SVG for score ring, Tailwind, TypeScript

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/add_discipline_score.sql` | DB migration: adds 2 columns to daily_sessions |
| Modify | `types/index.ts` | Add `DisciplineBreakdown` interface; add 2 fields to `DailySession` |
| Create | `lib/session-grader.ts` | Pure `computeDisciplineScore` function — no DB, no side effects |
| Create | `components/dashboard/DisciplineScoreCard.tsx` | Card UI (ring + 2×2 grid) + auto-save useEffect |
| Modify | `app/(app)/dashboard/page.tsx` | Pass `userId` and `date` to `DashboardClient` |
| Modify | `app/(app)/dashboard/DashboardClient.tsx` | Add `userId`/`date` props, mount `DisciplineScoreCard` |

---

## Task 1: DB Migration + Types

**Files:**
- Create: `supabase/add_discipline_score.sql`
- Modify: `types/index.ts`

> **Important:** The migration must be run in the Supabase dashboard SQL editor BEFORE the app code is deployed. If the columns don't exist, the upsert will silently fail.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/add_discipline_score.sql
ALTER TABLE daily_sessions
  ADD COLUMN IF NOT EXISTS discipline_score int CHECK (discipline_score >= 0 AND discipline_score <= 100),
  ADD COLUMN IF NOT EXISTS discipline_breakdown jsonb;
```

- [ ] **Step 2: Run the migration**

Open the Supabase dashboard → SQL editor → paste the contents of `supabase/add_discipline_score.sql` → click Run.

Expected: "Success. No rows returned."

- [ ] **Step 3: Update `types/index.ts`**

Find the `DailySession` interface (line 55) and add two fields:

```ts
export interface DailySession {
  id: string
  user_id: string
  date: string
  pre_market_brief: PreMarketBrief | null
  end_of_day_summary: EndOfDaySummary | null
  checklist_passed: boolean | null
  emotion_score: number | null
  notes: string | null
  created_at: string
  discipline_score: number | null
  discipline_breakdown: DisciplineBreakdown | null
}
```

Add the new `DisciplineBreakdown` interface directly above `DailySession`:

```ts
export interface DisciplineBreakdown {
  setup: number
  emotion: number
  prep: number
  grade: number
}
```

- [ ] **Step 4: Type-check**

```bash
cd ~/es-trading-journal && npx tsc --noEmit 2>&1
```

Expected: no output (clean exit).

- [ ] **Step 5: Commit**

```bash
cd ~/es-trading-journal
git add supabase/add_discipline_score.sql types/index.ts
git commit -m "$(cat <<'EOF'
Dashboard: add discipline_score schema and types

Migration adds discipline_score int (0-100) and discipline_breakdown jsonb
to daily_sessions. DisciplineBreakdown interface added to types/index.ts.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure Scoring Engine

**Files:**
- Create: `lib/session-grader.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/session-grader.ts
import { Trade, DailySession, DisciplineBreakdown } from '@/types'

export interface DisciplineScore {
  score: number
  breakdown: DisciplineBreakdown
}

const EMOTIONAL_MOODS = new Set(['FOMO', 'fomo', 'revenge', 'anxious', 'overconfident'])

export function computeDisciplineScore(
  trades: Trade[],
  session: DailySession | null,
): DisciplineScore {
  const total = trades.length

  // 1. Setup compliance (25 pts) — F-grade = off-system discipline lapse
  const nonF = trades.filter((t) => t.grade !== 'F').length
  const setup = total === 0 ? 25 : Math.round((nonF / total) * 25)

  // 2. Emotional discipline (25 pts) — FOMO/revenge/anxious/overconfident = penalty
  const emotional = trades.filter((t) => t.mood !== null && EMOTIONAL_MOODS.has(t.mood!)).length
  const emotion = total === 0 ? 25 : Math.round(((total - emotional) / total) * 25)

  // 3. Pre-market prep (25 pts) — checklist must be explicitly passed
  const prep = session?.checklist_passed === true ? 25 : 0

  // 4. Trade grade quality (25 pts) — A/B out of all graded trades
  const graded = trades.filter((t) => t.grade !== null)
  const ab = graded.filter((t) => t.grade === 'A' || t.grade === 'B').length
  const grade = graded.length === 0 ? 25 : Math.round((ab / graded.length) * 25)

  return {
    score: setup + emotion + prep + grade,
    breakdown: { setup, emotion, prep, grade },
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd ~/es-trading-journal && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd ~/es-trading-journal
git add lib/session-grader.ts
git commit -m "$(cat <<'EOF'
Dashboard: add pure session scoring engine

computeDisciplineScore: 4 dimensions x 25pts each = 0-100. No DB calls,
no side effects. Setup compliance, emotional discipline, pre-market prep,
trade grade quality.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: DisciplineScoreCard Component

**Files:**
- Create: `components/dashboard/DisciplineScoreCard.tsx`

The SVG ring uses `r=30` in a `72×72` viewBox. Circumference = `2 * Math.PI * 30 ≈ 188.5`. `strokeDashoffset = CIRCUMFERENCE * (1 - score/100)` controls how much of the ring is filled.

- [ ] **Step 1: Create the file**

```tsx
// components/dashboard/DisciplineScoreCard.tsx
'use client'

import { useMemo, useEffect } from 'react'
import { Trade, DailySession } from '@/types'
import { computeDisciplineScore } from '@/lib/session-grader'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface Props {
  trades: Trade[]
  session: DailySession | null
  userId: string
  date: string
}

const CIRCUMFERENCE = 2 * Math.PI * 30

function ringColor(score: number): string {
  if (score >= 90) return '#10b981'
  if (score >= 70) return '#f59e0b'
  return '#ef4444'
}

function scoreColorClass(score: number): string {
  if (score >= 90) return 'text-emerald-400'
  if (score >= 70) return 'text-amber-400'
  return 'text-red-400'
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'Good session'
  if (score >= 70) return 'Solid'
  return 'Needs work'
}

function cellIcon(pts: number): string {
  if (pts === 25) return '✅'
  if (pts === 0) return '❌'
  return '⚠️'
}

function cellColorClass(pts: number): string {
  if (pts === 25) return 'text-emerald-400'
  if (pts === 0) return 'text-red-400'
  return 'text-amber-400'
}

export default function DisciplineScoreCard({ trades, session, userId, date }: Props) {
  const { score, breakdown } = useMemo(
    () => computeDisciplineScore(trades, session),
    [trades, session],
  )

  useEffect(() => {
    if (trades.length === 0) return
    const supabase = createClient()
    supabase.from('daily_sessions').upsert(
      {
        user_id: userId,
        date,
        discipline_score: score,
        discipline_breakdown: breakdown,
      },
      { onConflict: 'user_id,date' },
    )
  }, [score, breakdown, userId, date, trades.length])

  if (trades.length === 0) return null

  const dashOffset = CIRCUMFERENCE * (1 - score / 100)
  const color = ringColor(score)

  const cells = [
    { label: 'Setup', pts: breakdown.setup },
    { label: 'Emotion', pts: breakdown.emotion },
    { label: 'Prep', pts: breakdown.prep },
    { label: 'Grade', pts: breakdown.grade },
  ]

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-white">Discipline Score</p>
        <p className="text-xs text-gray-500">Today · auto-saved</p>
      </div>

      <div className="flex items-center gap-5 mb-4">
        <div className="relative w-[72px] h-[72px] flex-shrink-0">
          <svg viewBox="0 0 72 72" width="72" height="72">
            <circle
              cx="36" cy="36" r="30"
              fill="none"
              stroke="#374151"
              strokeWidth="6"
            />
            <circle
              cx="36" cy="36" r="30"
              fill="none"
              stroke={color}
              strokeWidth="6"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 36 36)"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('text-lg font-bold', scoreColorClass(score))}>{score}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">out of 100</p>
          <p className={cn('text-sm font-semibold', scoreColorClass(score))}>
            {scoreLabel(score)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {cells.map(({ label, pts }) => (
          <div
            key={label}
            className="bg-gray-800 rounded-xl px-3 py-2 flex items-center gap-2"
          >
            <span className="text-base leading-none">{cellIcon(pts)}</span>
            <div>
              <p className="text-[10px] text-gray-400">{label}</p>
              <p className={cn('text-xs font-bold', cellColorClass(pts))}>
                {pts}/25
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd ~/es-trading-journal && npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd ~/es-trading-journal
git add components/dashboard/DisciplineScoreCard.tsx
git commit -m "$(cat <<'EOF'
Dashboard: add DisciplineScoreCard component

SVG score ring (0-100) + 2x2 icon grid (Setup/Emotion/Prep/Grade).
Auto-saves via Supabase upsert on score change. Silent-when-clean:
returns null when no trades exist today.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire into Dashboard

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(app)/dashboard/DashboardClient.tsx`

- [ ] **Step 1: Update `page.tsx` to pass `userId` and `date`**

The page already has `user.id` (line 10) and `today` (line 13). Update the `DashboardClient` mount:

```tsx
  return (
    <DashboardClient
      trades={(trades as Trade[]) || []}
      todayTrades={(todayTrades as Trade[]) || []}
      riskRules={(riskRulesData as RiskRules) || defaultRiskRules}
      session={(sessionData as DailySession) || null}
      userId={user.id}
      date={today}
    />
  )
```

- [ ] **Step 2: Update `DashboardClientProps` and add the import**

At the top of `DashboardClient.tsx`, add the import:

```tsx
import DisciplineScoreCard from '@/components/dashboard/DisciplineScoreCard'
```

Update the props interface:

```tsx
interface DashboardClientProps {
  trades: Trade[]
  todayTrades: Trade[]
  riskRules: RiskRules
  session: DailySession | null
  userId: string
  date: string
}
```

Update the function signature:

```tsx
export default function DashboardClient({ trades, todayTrades, riskRules, session, userId, date }: DashboardClientProps) {
```

- [ ] **Step 3: Mount the card**

Add `DisciplineScoreCard` after the `OffSystemDamageCard` line (line 151):

```tsx
      {/* Off-system damage — silent when there are no F trades this month */}
      <OffSystemDamageCard trades={trades} />

      {/* Discipline score — silent when no trades today */}
      <DisciplineScoreCard
        trades={todayTrades}
        session={session}
        userId={userId}
        date={date}
      />

      {/* Session timer */}
      <SessionTimer todayTrades={todayTrades} />
```

- [ ] **Step 4: Type-check the full project**

```bash
cd ~/es-trading-journal && npx tsc --noEmit 2>&1
```

Expected: no output. If you see errors about `userId` or `date`, check that `DashboardClientProps` was updated in Step 2 and `page.tsx` was updated in Step 1.

- [ ] **Step 5: Commit**

```bash
cd ~/es-trading-journal
git add app/\(app\)/dashboard/page.tsx app/\(app\)/dashboard/DashboardClient.tsx
git commit -m "$(cat <<'EOF'
Dashboard: mount DisciplineScoreCard in DashboardClient

Pass userId and date from page.tsx server component. Mount card between
OffSystemDamageCard and SessionTimer.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Manual Verification

**Files:** none — browser testing only

- [ ] **Step 1: Confirm migration is applied**

Open Supabase dashboard → Table Editor → `daily_sessions`. Verify columns `discipline_score` and `discipline_breakdown` appear.

- [ ] **Step 2: Start dev server**

```bash
cd ~/es-trading-journal && npm run dev
```

Open `http://localhost:3000`.

- [ ] **Step 3: Verify card shows when trades exist today**

If you have trades logged today, the Discipline Score card should appear between OffSystemDamageCard and SessionTimer on the dashboard. Verify:

| Check | Expected |
|---|---|
| Card visible | Yes — only when today has trades |
| Score ring | Filled proportionally to score, color-coded |
| Score number | Centered inside ring, correct color |
| Label | "Good session" / "Solid" / "Needs work" |
| 2×2 grid | 4 cells: Setup, Emotion, Prep, Grade with X/25 |
| Cell icons | ✅ for 25, ⚠️ for partial, ❌ for 0 |
| Subtitle | "Today · auto-saved" |

- [ ] **Step 4: Verify auto-save**

After the dashboard loads, open Supabase dashboard → Table Editor → `daily_sessions` → find today's row. Verify `discipline_score` and `discipline_breakdown` have been written.

`discipline_breakdown` should look like:
```json
{"setup": 25, "emotion": 25, "prep": 0, "grade": 19}
```

- [ ] **Step 5: Verify silent-when-clean**

Check another user account with no trades today (or use a date with no trades). The card should not appear — the space between `OffSystemDamageCard` and `SessionTimer` should be empty.

- [ ] **Step 6: Push to production**

```bash
cd ~/es-trading-journal && git push origin main
```
