# Replay Engine — Design Spec

**Date:** 2026-05-18
**Author:** Shawn (with Claude)
**Scope:** Spec 1 of 2 (FireLines Port + Overlay is Spec 2)
**Target module:** `components/blind-backtest/`

---

## Problem

The existing blind backtest tests trade *planning*: you see a snapshot at a cutoff bar, commit a plan, and the outcome is revealed instantly. It validates whether a pre-trade thesis would have worked, but it does not train the live skill — **reading structure as bars unfold and pulling the trigger when the setup forms**.

Live trading is not "stare at a snapshot and decide." It is "scan continuously, recognize a setup forming, pull the trigger before the moment passes." A replay engine that simulates that is the single biggest gap between the current journal and a tool that builds great trading reflexes.

## Goal

Convert the blind backtest from a static-cutoff snapshot tool into a bar-by-bar playback engine with enforced pre-trade discipline and an honest mistake taxonomy.

**Mode B ("Trigger-puller") only for v1.** Mode A ("Planner") is deferred.

## Out of scope

- FireLines overlay on chart → Spec 2
- Stats by FireLines level / structure-aware metrics → Spec 2
- Real ES futures data (Polygon Futures plan required, separate budget decision) — SPY proxy stays
- Mode A "Planner" playback toggle — deferred to a later spec
- Mobile/touch playback controls — desktop only for v1

---

## User flow

### Phase machine

```
home
  ↓
session-setup           (existing: pick setup filter, time window, trade count)
  ↓
charting                (existing: chart loads to cutoff, no peek)
  ↓
checklist               (NEW: 5-pillar gate + direction/entry/stop/target)
  ↓
playback                (NEW: bars advance, trade is "live")
  ↓
reveal                  (existing: outcome calculated)
  ↓
grading                 (existing + mistake_type selector added)
  ↓
complete                (existing: stats updated, next trade or end session)
```

### Phase: checklist (new)

Replaces the current trade-form submission step. Renders the 5-pillar discipline check as an explicit gate:

| Pillar | UI | Source |
|---|---|---|
| Bias | text input, required | from `TradeForm.bias` |
| Setup | dropdown of 5 setups, required | from `lib/trading-system.ts` PLAYBOOK_SETUPS |
| Trigger | text input, required | from `TradeForm.trigger` |
| Location | text input, required | from `TradeForm.location` |
| Risk | entry/stop/target numeric inputs, all required | from `TradeForm.{entryPrice,stopPrice,targetPrice}` |

**Plus:** direction (long/short) and confidence (1–5).

**Gate behavior:**
- "Start Playback" button **disabled** until all 5 pillars + direction are non-empty.
- No "skip" or "bypass" affordance. Friction is the point.
- Once "Start Playback" is clicked, the trade plan is locked. Pillars cannot be edited during playback. The plan you commit to is the plan you live with.

### Phase: playback (new)

Bars advance from `cutoffIndex` forward through `fullCandles`. The chart re-renders as the slice grows.

**Controls:**

| Control | Behavior |
|---|---|
| Play / Pause | Toggle auto-advance |
| Speed | 0.5× / 1× / 2× / 5× (1× = one 5-min bar per second of wall time) |
| Step | Advance one bar manually (only enabled while paused) |
| Bail | Abandon the trade as `SCRATCH` — counted but does not become a win/loss |

**No backward step.** Forward-only progression. If you saw it, you saw it.

**Auto-halt conditions** (whichever fires first):
1. Price touches `stopPrice` → outcome `LOSS`
2. Price touches `targetPrice` → outcome `WIN`
3. End of session reached (3:15 PM CT close, last candle of `fullCandles`) → outcome `SCRATCH`
4. User clicks "Bail" → outcome `SCRATCH`

**Outcome resolution** uses the same formulas as today (`gross_pnl`, `r_multiple`, `mfe`, `mae`) plus two new computed metrics:
- `bars_held` — number of 5-min bars from `entry_bar_index` to halt bar
- `entry_bar_index` — which bar in `fullCandles` the trade went live on

For Mode B, `entry_bar_index === cutoffIndex` always (entry is locked at the moment Play is first pressed). This field exists for future Mode A compatibility, where entry timing varies.

### Phase: grading (existing + one addition)

Add **mistake type selector** below the existing self-grade dropdown:

```
What broke down? (or "clean" if nothing did)
  ○ Outside time window
  ○ Broke checklist (claimed pillars I didn't actually verify)
  ○ No setup confluence
  ○ Chased entry (price ran before I clicked)
  ○ Held loser past mental stop
  ○ Cut winner too early
  ○ FOMO — wasn't really my setup
  ○ Clean — no mistake, just a loss
  ○ Other  [free text input revealed]
```

The "Clean" option matters: losing trades are not always mistakes. Tracking the difference teaches when to refine vs when to accept variance.

---

## Data model

Single migration: `supabase/replay_engine_migration.sql`

```sql
ALTER TABLE blind_backtest_trades
  ADD COLUMN mistake_type    TEXT,
  ADD COLUMN mistake_other   TEXT,
  ADD COLUMN bars_held       INTEGER,
  ADD COLUMN entry_bar_index INTEGER,
  ADD COLUMN playback_mode   TEXT NOT NULL DEFAULT 'B';
```

- `mistake_type` — one of the predefined enum strings above, or `'other'`
- `mistake_other` — populated only when `mistake_type = 'other'`
- `bars_held` — nullable for old rows (pre-migration trades won't have this)
- `entry_bar_index` — nullable for old rows
- `playback_mode` — defaults to `'B'`; existing rows are correctly tagged `'B'` because the current behavior is closest to a degenerate Mode B (instant outcome)

**Migration workflow** follows the project convention in `CLAUDE.md`: write SQL → paste into Supabase SQL editor → note in session carryover that it has been applied.

---

## Component architecture

### Files to modify

| File | Change |
|---|---|
| `components/blind-backtest/BlindBacktestClient.tsx` | Add `checklist` and `playback` to `Phase` union. Add `replayIndex` state. Add playback timer logic (interval-driven advance based on `playbackSpeed`). Lock trade form once playback starts. |
| `components/blind-backtest/CandlestickChart.tsx` | Accept `displayedCandles: Candle[]` prop. Stop slicing internally — let the parent control which bars are rendered. |
| `components/blind-backtest/StatsView.tsx` | Add "Mistakes Breakdown" section: count and R-mult grouped by `mistake_type`. |
| `app/api/blind-backtest/trades/route.ts` | Accept and persist `mistake_type`, `mistake_other`, `bars_held`, `entry_bar_index`, `playback_mode` on POST. |
| `types/index.ts` | Extend `BlindBacktestTrade` interface with the five new columns. |

### Files to create

| File | Purpose |
|---|---|
| `components/blind-backtest/PreTradeChecklist.tsx` | 5-pillar gate UI. Owns the trade-form state until "Start Playback" is clicked. Disables button until all pillars filled. |
| `components/blind-backtest/PlaybackControls.tsx` | Play / Pause / Speed selector / Step / Bail. Pure UI — receives state and handlers as props. |
| `components/blind-backtest/MistakeSelector.tsx` | Radio group rendered in grading phase. Reveals `mistake_other` text input when "Other" selected. |
| `supabase/replay_engine_migration.sql` | The single migration file. |

### State flow inside `BlindBacktestClient`

```
phase: 'charting' → user clicks "Place Trade" (existing button, repurposed) → phase: 'checklist'
phase: 'checklist' → 5 pillars valid → user clicks "Start Playback" → phase: 'playback'
                                                                       replayIndex = cutoffIndex
                                                                       entry_bar_index = cutoffIndex
                                                                       playbackPlaying = true
phase: 'playback' →
  setInterval ticks based on speed →
    replayIndex++
    check stop/target against fullCandles[replayIndex].{high, low}
    if hit → clearInterval, set outcome, phase: 'reveal'
    if replayIndex === fullCandles.length - 1 → outcome: SCRATCH, phase: 'reveal'
phase: 'reveal' → existing AI grade fetch → phase: 'grading'
phase: 'grading' → mistake_type selected + self-grade submitted → phase: 'complete'
```

**Stop/target hit detection:**
- Long trade: stop hit when `fullCandles[i].low <= stopPrice`; target hit when `fullCandles[i].high >= targetPrice`
- Short trade: stop hit when `fullCandles[i].high >= stopPrice`; target hit when `fullCandles[i].low <= targetPrice`
- If both happen in the same bar, prefer the stop (conservative — simulates worst-case slippage where stop fires first)

---

## Stats additions

New section in `StatsView.tsx`:

**Mistakes Breakdown**
- Bar chart: count of trades per `mistake_type`
- Table: by mistake type → trade count, win count, avg R-multiple
- Insight surfaced: "Your worst mistake is X — N trades, average R of −X.X"

The existing **By Setup** and **By Time Window** sections stay as-is.

---

## Testing

Per project convention (`CLAUDE.md`): manual UI verification + `npx tsc --noEmit` is the gating check. No unit tests.

**Manual test checklist** (run before marking complete):

1. Run a full session with at least 3 trades
2. Verify checklist gate: confirm "Start Playback" stays disabled when any pillar is blank
3. Verify playback: bars advance visibly, speed control changes rate, pause halts cleanly
4. Verify stop-hit detection: place a stop very close to entry, confirm auto-halt with LOSS outcome
5. Verify target-hit detection: place target very close, confirm auto-halt with WIN outcome
6. Verify bail: confirm SCRATCH outcome and stats update
7. Verify mistake type persists: select "FOMO," save, reload session, confirm value
8. Verify stats: confirm Mistakes Breakdown renders with the right counts
9. Run `npx tsc --noEmit` — must pass with zero errors

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `setInterval` drift makes 1× speed feel inconsistent | Use `requestAnimationFrame` with delta-time tracking instead of naive interval |
| User pauses mid-playback for hours, browser tab throttled | Acceptable — pause is meant to be intentional study time |
| Migration applied out of order with existing rows | New columns are all nullable except `playback_mode`, which has a default → safe to apply against existing data |
| Refactor changes the in-session phase flow for users mid-session at deploy time | The phase machine is runtime state, not persisted. Any session in progress when the deploy lands will lose its in-flight chart state. Accept this — there is only one user and sessions are short. Communicate the deploy if a session is active. |

---

## What success looks like

After 50 replay sessions, Shawn can answer with data:

- Which setup do I execute best?
- What's my most common mistake?
- When I "bail," what's my actual P&L impact vs holding?
- What's my win rate when all 5 pillars genuinely had answers, vs when I forced them?

Spec 2 (FireLines) will add: which FireLines structure do I read best? But that's next session.
