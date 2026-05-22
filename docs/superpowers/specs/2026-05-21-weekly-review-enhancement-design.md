# Weekly Review Enhancement — Design Spec
**Date:** 2026-05-21
**Status:** Approved

---

## Problem

The weekly review already generates a Claude debrief on demand, but two gaps limit its value:

1. It requires manual action — the review isn't there when you open the page Friday evening.
2. It doesn't know about discipline scores. The new `discipline_score` field on `daily_sessions` (added 2026-05-21) captures rule compliance per day but is never surfaced in the weekly debrief.

---

## Scope

- Vercel cron job that auto-generates the weekly review every Friday at 15:00 CT
- Day-by-day discipline score trend added to the Claude prompt and output
- New `discipline_trend` section on the weekly review page
- Subtle UI tweak: "Generates automatically Friday after close" note when no review exists yet

---

## Architecture

### New file: `app/api/cron/weekly-review/route.ts`

Server route secured with the existing `CRON_SECRET` header (same pattern as `app/api/tradovate/cron/route.ts`). Fires every Friday at 21:00 UTC (15:00 CT, after session close).

Logic:
1. Verify `Authorization: Bearer <CRON_SECRET>` header
2. Get the authenticated service-role Supabase client
3. Compute current week's Monday date (same `thisWeekMonday()` logic already in the page)
4. Check if a `weekly_reviews` row already exists for this week — if yes, skip (don't overwrite a manual run)
5. Fetch all users (single-user app — just the one user in `auth.users`)
6. Call the existing weekly review generation logic (same API body as the manual POST to `/api/claude/weekly-review`)
7. The existing route handles the upsert to `weekly_reviews`

### `vercel.json` update

Add a new cron entry alongside the existing Tradovate cron:

```json
{ "path": "/api/cron/weekly-review", "schedule": "0 21 * * 5" }
```

### Modified file: `app/api/claude/weekly-review/route.ts`

The route already fetches `daily_sessions` for the week. Add discipline score data to the Claude prompt:

```
Discipline scores this week (0-100, null = no trades that day):
Mon 05/19: 82  (setup 25, emotion 25, prep 0, grade 32)
Tue 05/20: 91
Wed 05/21: null
Thu 05/22: 64
Fri 05/23: 78
Weekly avg: 78.8
```

Claude is instructed to return a new `discipline_trend` field in its JSON response with:
- `days`: array of `{ date: string, score: number | null }` — the raw per-day scores
- `narrative`: 2-3 sentences on what the trend shows, what drove any dips, whether discipline is improving or slipping

### Modified file: `types/index.ts`

Add `discipline_trend` to `WeeklyReviewContent`:

```ts
export interface WeeklyReviewContent {
  summary: string
  system_compliance: {
    score: number
    wins: string[]
    violations: string[]
  }
  setup_breakdown: Array<{
    setup: string
    trades: number
    win_rate: number
    pnl: number
    key_insight: string
  }>
  emotional_trends: string
  discipline_trend: {
    days: Array<{ date: string; score: number | null }>
    narrative: string
  }
  top_lessons: string[]
  next_week_focus: string[]
}
```

No DB schema change — `weekly_reviews.review` is already `jsonb`.

### Modified file: `app/(app)/weekly-review/page.tsx`

Two changes:

**1. Auto-generate note:** When `review` is null, show a subtle gray note below the header: "Generates automatically Friday after close" instead of implying the user must act.

**2. New `DisciplineTrend` section:** Rendered between system compliance and setup breakdown. Contains:
- Section title: "Discipline Trend" with weekly average score
- Day chips row: Mon · Tue · Wed · Thu · Fri — each chip shows the score (or "—" for null days), color-coded: green ≥90, amber ≥70, red <70, gray for null
- Claude's narrative paragraph below the chips

---

## Data Flow

```
Friday 15:00 CT
  └─> Vercel cron fires /api/cron/weekly-review
        └─> Check: review exists for this week? → skip if yes
        └─> POST /api/claude/weekly-review { weekStartDate }
              └─> Fetch trades + daily_sessions (with discipline_score)
              └─> Build prompt with day-by-day scores
              └─> Claude returns JSON with discipline_trend added
              └─> Upsert to weekly_reviews
User opens /weekly-review Friday evening
  └─> review already populated → renders including DisciplineTrend section
```

---

## Constraints

- Cron must skip if review already exists (no silent overwrites of manual runs)
- `discipline_trend.days` scores come from `daily_sessions.discipline_score` — null for days with no trades
- Color thresholds match DisciplineScoreCard: ≥90 emerald, ≥70 amber, <70 red
- No new DB columns
- `CRON_SECRET` already set in Vercel env — no new env vars needed
- Weekly average in the prompt excludes null days from the denominator
