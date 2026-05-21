# F Grade — Off-System Trade Flag

**Status:** Approved — ready for implementation plan
**Date:** 2026-05-20

## Summary

Add an `F` grade representing an **off-system trade** — a trade that wasn't one of the 5 setups in the playbook. F is conceptually distinct from A/B/C (which grade quality *within* the system); it overrides the grade entirely to mark "this trade should not have happened."

When F is set, the annotation form collapses to two fields: *what made you enter* and *post-trade notes*. F trades are excluded from system performance stats and surfaced separately as "Off-system damage" so the cost of discipline lapses is visible without distorting the system's track record.

## Conceptual Model

| Grade | Meaning |
|---|---|
| A | All system rules followed, clean execution |
| B | One minor deviation within the system |
| C | Rule violation **within** the system |
| **F** | **Off-system** — trade wasn't one of the 5 setups at all |

C is "I violated a rule." F is "I violated the system itself." Different category, different remediation.

F is **self-assigned only.** The AI grader never assigns F because Claude can't reliably judge from trade facts whether a setup *was* on the playbook — that's a self-judgment about discipline.

## Data Model

**Storage:** F is stored as `grade = 'F'` in the existing column. Single source of truth, no new boolean.

**Migration** — `supabase/add_f_grade.sql`:
- Alter `trades.grade` CHECK constraint: `IN ('A', 'B', 'C')` → `IN ('A', 'B', 'C', 'F')`
- Alter `trades.self_grade` CHECK constraint: same expansion
- `trades.ai_grade` CHECK constraint unchanged — stays `IN ('A', 'B', 'C')`

**TypeScript:**
- `Trade['grade']`: `'A' | 'B' | 'C' | null` → `'A' | 'B' | 'C' | 'F' | null`
- `Trade['self_grade']`: same
- `Trade['ai_grade']`: unchanged
- The `GRADES` const in `TradeAnnotationForm.tsx` stays `['A', 'B', 'C']` — F is not selected from that row

**Claude prompt:** `lib/trading-system.ts` rubric block is unchanged. Claude grades A/B/C only.

## Form UI — `components/journal/TradeAnnotationForm.tsx`

A new section below the existing grade row + rubric:

```
┌─────────────────────────────────────┐
│  [A]   [B]   [C]                    │
│  ▸ Grade Guide                      │
└─────────────────────────────────────┘

  ☐ Off-system trade (F)
    Use when the trade wasn't one of the 5 setups —
    a discipline lapse, not a graded execution.
```

**Toggle behavior:**

| State | Form contents |
|---|---|
| Off (default) | Existing form, unchanged |
| On | Hide: Mood, Grade row + rubric, Setup Tag, MAE/MFE/SL/Target, Tags, Chart Screenshots. Show: Instrument, Apex Account, Notes (relabeled), Reflection (relabeled), Actions row. |

**Relabeled textareas when toggle is on:**
- Notes label → "What made you enter this trade?"
- Notes placeholder → "Boredom, FOMO, news pop, pattern that looked good but wasn't on the list…"
- Reflection label → "Post-trade notes — what did you learn?"
- Reflection placeholder → "What was the cost? What would have stopped you?"

**Save behavior when toggle is on:**
- `grade = 'F'`
- `setup_tag = null` (forced — off-system trade has no setup)
- Other hidden fields are **preserved** rather than cleared, so toggling back off restores any prior values.

**Initialization on existing trades:**
- If `trade.grade === 'F'`, the toggle initializes to `on`.
- Switching toggle from `on` back to `off` clears `grade` (returns to ungraded) — the user must actively re-pick A/B/C.

## Visual Treatment in Trade List

Wherever A/B/C grade badges currently render in the journal/trade list, F renders as a small **black badge with white text** — visually distinct from C's red. The category jump is reinforced visually.

## Stats Handling

Two buckets, with a single helper:

```ts
// lib/trade-flags.ts (or lib/utils.ts)
export const isSystemTrade = (t: Trade) => t.grade !== 'F'
```

**Excluded from F** (filter with `isSystemTrade` before reducing):
- Headline win rate
- Expectancy
- Avg win / avg loss
- By-setup performance (also auto-excluded — F trades have null `setup_tag`)
- By-time-window performance

**Includes F** (no filter — real money is real):
- Total P&L, daily P&L, weekly/monthly P&L
- Apex account P&L and drawdown
- Risk circuit breakers / daily loss limit

## Off-System Damage Card

**New component:** `components/dashboard/OffSystemDamageCard.tsx`

**Visibility:** Silent when month-to-date count of F trades = 0 (per `silent-when-clean` convention).

**Placement:** Dashboard, below the existing daily/weekly P&L cards, alongside the risk-status cards.

**Period:** Month-to-date (aligns with monthly Apex rhythm).

**Content:**
- Count of F trades
- Net P&L sum from F trades
- Biggest single loss from an F trade
- Timestamp of the most recent F trade, linked to its detail view

**Visual:** Outlined card matching the black-badge treatment of the F grade. Distinct from the green/red P&L card styling so it reads as a separate category.

## Weekly Review Surface

In the existing weekly review page, add a **"Discipline"** section above the recap.

**Content:**
- Header line: count of F trades this week + total net damage
- Inline list of each F trade: timestamp · instrument · P&L · the "what made you enter" text
- Silent when zero F trades this week (silent-when-clean)

The point of this surface is reflective: reading your own *reasons* back to yourself during the weekly review is what does the behavioral work.

## Files Touched

**New:**
- `supabase/add_f_grade.sql` — migration
- `components/dashboard/OffSystemDamageCard.tsx` — new dashboard card
- `lib/trade-flags.ts` — extend existing file with the `isSystemTrade` helper

**Modified:**
- `types/index.ts` — `grade` and `self_grade` unions expand to include `'F'`
- `components/journal/TradeAnnotationForm.tsx` — toggle, conditional rendering, relabeling, save logic
- Wherever trade-list grade badges are rendered — add F = black badge case
- Dashboard page — mount `OffSystemDamageCard`
- Weekly Review page — add Discipline section
- Stats `useMemo` blocks across the app — gate "system" stats on `isSystemTrade`

## Explicitly Out of Scope (YAGNI)

- No dedicated "Discipline" sidebar tab. Dashboard card + weekly review surface only.
- No new column for "trigger reason" — reusing `notes` with a relabel.
- No AI assignment of F or AI feedback on F trades. Claude grader stays A/B/C.
- No automated detection of off-system trades (e.g., from setup_tag patterns). Self-assigned only.
- No retroactive backfill — existing trades stay A/B/C/null until manually re-annotated.
- No streaks, leaderboards, or alerts on F trades. The damage card + weekly section is the entire feedback loop.

## Verification Plan

Manual UI verification per project convention. After implementation:

1. Run migration in Supabase SQL editor.
2. `npx tsc --noEmit` — gating check passes.
3. Open an existing trade, toggle off-system on/off, verify field visibility and save behavior.
4. Save an F trade, verify it shows the black badge in the journal list.
5. Verify dashboard headline win rate excludes the new F trade.
6. Verify dashboard total P&L includes it.
7. Verify the Off-System Damage card appears and shows the correct count/sum.
8. Verify the Weekly Review's Discipline section renders the F trade with its reason text.
9. Save a second trade A/B/C — confirm card and badge logic stay correct.
