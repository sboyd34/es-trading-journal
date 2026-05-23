# Liquidity Map — ICT Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lineless ICT-style liquidity indicator for ThinkOrSwim that marks buy-side and sell-side liquidity from both algorithmic pivots and session levels, watches them get hunted in real time, and works across any ticker, timeframe, and trading hour. Also back up the current FireLines indicator.

**Architecture:** Two ThinkScript files in a new `tos_indicators/` directory of the repo: `liquidity_map.ts` (the new indicator) and `firelines.ts` (backup of the current FireLines script). These files are pure reference copies — TOS runs the scripts from its own study editor, not from the filesystem. The repo files serve as versioned backups and as a single source of truth for future Claude/Codex sessions that need to modify the indicators.

**Tech Stack:** ThinkScript (TOS's domain-specific language). No TypeScript compilation. No tests. Verification is manual: paste each phase's script into TOS, apply to a chart, eyeball the behavior.

**Codebase conventions (apply to every task):**
- Atomic commits per concern. Commit message format: `<Area>: <imperative phrase>`. Body explains *why*, not *what*. Trailer: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- `npx tsc --noEmit` must pass after every task touching repo files.
- No tests — verification is manual TOS check + tsc.
- All `tos_indicators/*.ts` files contain ThinkScript, not TypeScript. They must be excluded from tsc.

**Working directory note:** All commands assume the working directory is `/Users/shawndeeboyd/es-trading-journal`. If your shell sits elsewhere, prepend `cd /Users/shawndeeboyd/es-trading-journal && ...` or use `git -C /Users/shawndeeboyd/es-trading-journal ...`.

---

## Task 1: Create `tos_indicators/` directory + exclude from TypeScript

**Files:**
- Create: `tos_indicators/` (directory)
- Create: `tos_indicators/README.md`
- Modify: `tsconfig.json`

**Why:** `tsconfig.json` currently has `"include": ["**/*.ts", ...]` which means TypeScript will try to compile any `.ts` file in the repo. ThinkScript files use `.ts` by convention but are *not* TypeScript — they'd fail compilation. Adding `tos_indicators` to the exclude array isolates the new directory from the build.

- [ ] **Step 1: Create the directory and a README**

```bash
mkdir -p /Users/shawndeeboyd/es-trading-journal/tos_indicators
```

Then create `tos_indicators/README.md` with this content:

```markdown
# TOS Indicators

Backup and reference copies of ThinkOrSwim ThinkScript indicators.

These files use `.ts` extension by convention — they are **ThinkScript**, not TypeScript. They are excluded from `tsconfig.json` and are not compiled by Next.js or run by Node.

TOS reads its scripts from the user's study editor, not the filesystem. The files here exist only as version-controlled backups and as a source of truth for future agent sessions that need to modify the indicators.

## Files

- `firelines.ts` — FireLines indicator (daily + weekly pivot projections, confluence detection with per-level labels)
- `liquidity_map.ts` — Liquidity Map indicator (ICT-style buy-side / sell-side liquidity tracking)

## Updating

When you modify an indicator in TOS:

1. In TOS: Studies → Edit Studies → select the indicator → select all script text → copy
2. In repo: paste-replace the contents of the corresponding `.ts` file
3. Commit with message format: `TOS: <indicator>: <what changed>`
```

- [ ] **Step 2: Add `tos_indicators` to `tsconfig.json` exclude**

Open `tsconfig.json`. The current `exclude` is:

```json
"exclude": ["node_modules"]
```

Change it to:

```json
"exclude": ["node_modules", "tos_indicators"]
```

- [ ] **Step 3: Verify tsc still passes**

Run:

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes cleanly. No errors.

- [ ] **Step 4: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/README.md tsconfig.json
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: scaffold tos_indicators/ directory

New directory for versioned backups of ThinkScript indicators. The
.ts extension is conventional in the TOS community but is not
TypeScript — exclude from tsconfig so the build doesn't try to
compile them.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Back up the current FireLines indicator

**Files:**
- Create: `tos_indicators/firelines.ts`

**Why:** FireLines is the user's primary indicator. It currently lives only in TOS's study editor — no backup exists. If TOS data is lost or the user re-installs, the script (including the recent per-level confluence labels work) would be gone. This task creates the first versioned backup.

- [ ] **Step 1: Copy the current FireLines script from TOS**

In ThinkOrSwim:

1. Open any chart
2. Click the Studies icon → Edit Studies
3. Find "FireLines" (or whatever name was used) in the My Studies list
4. Click it → the script appears in the right pane
5. Click inside the script pane, press Ctrl+A (Windows) or Cmd+A (Mac) to select all
6. Copy with Ctrl+C / Cmd+C

- [ ] **Step 2: Save to `tos_indicators/firelines.ts`**

Create `tos_indicators/firelines.ts` and paste the entire script content into it.

The file should start with the header comment block:

```thinkscript
# ═══════════════════════════════════════════════════════════════
#  FireLines Approximation for ThinkorSwim
#  Inspired by Rob Tovell's FireLines indicator (TradingView)
```

…and end with the final `Alert(...)` call for the confluence zone alert.

- [ ] **Step 3: Verify it doesn't break the build**

Run:

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes. (If it fails, the tsconfig exclude from Task 1 isn't working — double-check the change.)

- [ ] **Step 4: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/firelines.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: back up FireLines indicator

Snapshot of the production FireLines script including the recent
per-level confluence labels work. Future modifications should
update this file alongside any TOS-side changes so it stays in
sync with what's actually running.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Liquidity Map skeleton (inputs + ATR + session window)

**Files:**
- Create: `tos_indicators/liquidity_map.ts`

**Why:** Lay down the scaffolding the rest of the indicator builds on. After this task, the script parses in TOS but renders nothing visible — it's just the framework: inputs, ATR computation, session gating, and the file structure with comment sections marked for later tasks.

- [ ] **Step 1: Create the file with the skeleton**

Write `tos_indicators/liquidity_map.ts` with this content:

```thinkscript
# ═══════════════════════════════════════════════════════════════
#  Liquidity Map — ICT-Style Liquidity Indicator
#  Layers alongside FireLines on the same chart as an independent
#  indicator. Marks buy-side liquidity (above swing highs) and
#  sell-side liquidity (below swing lows) from two sources:
#   • Algorithmic intraday pivots (rolling 3 per direction)
#   • Session levels (PDH, PDL, ONH, ONL, PWH, PWL)
#
#  Three lifecycle states per level: LIVE / SWEPT / ACCEPTED.
#  Lineless visual: bubbles at right edge + sweep arrows on the
#  exact bar. ATR-based thresholds scale across any ticker.
#  Runs 24/7 by default (sessionGating = no) for night trading.
#
#  pivotLookback tuning suggestions:
#    1m chart   → 10–15  (filter noise)
#    5m chart   → 5–7    (default range)
#    15m chart  → 3–5    (otherwise pivots are too rare)
#    1H chart   → 3      (real swings need less padding)
# ═══════════════════════════════════════════════════════════════

declare upper;

# ── Detection parameters ─────────────────────────────────────────
input pivotLookback           = 5;
input pivotsToTrack           = 3;
input equalATRMult            = 0.15;
input approachATRMult         = 0.25;
input atrLength               = 14;
input atrAggregation          = AggregationPeriod.DAY;

# ── Source toggles ───────────────────────────────────────────────
input showAlgorithmicPivots   = yes;
input showSessionLevels       = yes;
input showPDH                 = yes;
input showPDL                 = yes;
input showONH                 = yes;
input showONL                 = yes;
input showPWH                 = yes;
input showPWL                 = yes;

# ── Feature toggles ──────────────────────────────────────────────
input showApproachAlerts      = yes;
input showSweepArrows         = yes;
input showEqualClusterLabels  = yes;
input showCornerSummary       = yes;

# ── Session gating (default OFF for night trading) ───────────────
input sessionGating           = no;
input sessionStartHHMM        = 0830;
input sessionEndHHMM          = 1500;

# ── ATR (ticker-agnostic distance threshold) ─────────────────────
def atr      = WildersAverage(TrueRange(high(period = atrAggregation),
                                         close(period = atrAggregation),
                                         low(period = atrAggregation)),
                              atrLength);
def equalThr    = equalATRMult    * atr;
def approachThr = approachATRMult * atr;

# ── Session window ───────────────────────────────────────────────
def inSession = if sessionGating
                then SecondsFromTime(sessionStartHHMM) >= 0 and SecondsTillTime(sessionEndHHMM) >= 0
                else yes;

def lastBar = BarNumber() == HighestAll(BarNumber());

# ════════════════════════════════════════════════════════════════
#  Sections below are filled in by subsequent implementation tasks:
#   • Task 4: Session levels (LIVE bubbles)
#   • Task 5: Session level lifecycle (SWEPT/ACCEPTED + arrows)
#   • Task 6: Algorithmic pivots (LIVE bubbles)
#   • Task 7: Algorithmic pivot lifecycle
#   • Task 8: Equal-highs/lows clustering
#   • Task 9: Corner labels
#   • Task 10: Alerts
# ════════════════════════════════════════════════════════════════
```

- [ ] **Step 2: Verify tsc passes**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Verify the script parses in TOS**

In ThinkOrSwim:

1. Studies → Create New Study → name it `Liquidity_Map`
2. Paste the contents of `tos_indicators/liquidity_map.ts` into the script editor
3. Click OK / Save
4. Apply the new study to any chart (e.g. /ES on 5m)

Expected: study compiles with no errors. Chart shows no new visual elements (skeleton has no plots yet). If TOS reports a syntax error, the script didn't parse — fix the issue before continuing.

- [ ] **Step 4: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map scaffolding (inputs + ATR + session window)

Skeleton for the new ICT-style liquidity indicator. Establishes
all user inputs, ATR-based distance thresholds (ticker-agnostic),
and the session-window predicate. Renders nothing visible yet —
subsequent tasks fill in the feature sections marked in comments.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Session levels (LIVE bubbles, no lifecycle yet)

**Files:**
- Modify: `tos_indicators/liquidity_map.ts`

**Why:** Add the six static session levels (PDH/PDL/ONH/ONL/PWH/PWL) as right-edge bubbles. At this stage every level is always LIVE — we'll add the lifecycle state machine in Task 5.

- [ ] **Step 1: Add session-level computation**

In `tos_indicators/liquidity_map.ts`, find the comment block at the bottom:

```thinkscript
# ════════════════════════════════════════════════════════════════
#  Sections below are filled in by subsequent implementation tasks:
```

Replace the entire comment block (down through the closing `# ═══...`) with this section:

```thinkscript
# ════════════════════════════════════════════════════════════════
#  SESSION LEVELS
#  Six static levels computed from prior-period OHLC. Each renders
#  as a right-edge bubble at its price when its toggle is on.
# ════════════════════════════════════════════════════════════════

def PDH = high(period = AggregationPeriod.DAY)[1];
def PDL = low(period  = AggregationPeriod.DAY)[1];
def PWH = high(period = AggregationPeriod.WEEK)[1];
def PWL = low(period  = AggregationPeriod.WEEK)[1];

# Overnight High/Low: highest/lowest price during the prior
# overnight window (17:00 prev day to 08:30 today CT). We approximate
# this with the rolling high/low of all bars where SecondsFromTime
# (08:30) < 0 — i.e. before today's RTH start.
def isOvernightBar = SecondsFromTime(0830) < 0 and SecondsFromTime(1700) >= 0;
def isNewSession   = SecondsFromTime(0830) >= 0 and SecondsFromTime(0830)[1] < 0;

def ONH = if isNewSession then Highest(high, 1) # placeholder reset
          else if isOvernightBar
               then if IsNaN(ONH[1]) then high else Max(ONH[1], high)
          else ONH[1];

def ONL = if isNewSession then Lowest(low, 1)
          else if isOvernightBar
               then if IsNaN(ONL[1]) then low else Min(ONL[1], low)
          else ONL[1];

# Session-level LIVE state (always LIVE for now — Task 5 adds lifecycle).
def PDH_live = yes;
def PDL_live = yes;
def ONH_live = yes;
def ONL_live = yes;
def PWH_live = yes;
def PWL_live = yes;

# ── Right-edge bubbles (LIVE state — bright color) ───────────────
AddChartBubble(showSessionLevels and showPDH and PDH_live and lastBar, PDH,
    "B-Liq PDH: " + Round(PDH, 2), Color.LIGHT_BLUE, yes);
AddChartBubble(showSessionLevels and showPDL and PDL_live and lastBar, PDL,
    "S-Liq PDL: " + Round(PDL, 2), Color.PINK, no);
AddChartBubble(showSessionLevels and showONH and ONH_live and lastBar, ONH,
    "B-Liq ONH: " + Round(ONH, 2), Color.LIGHT_BLUE, yes);
AddChartBubble(showSessionLevels and showONL and ONL_live and lastBar, ONL,
    "S-Liq ONL: " + Round(ONL, 2), Color.PINK, no);
AddChartBubble(showSessionLevels and showPWH and PWH_live and lastBar, PWH,
    "B-Liq PWH: " + Round(PWH, 2), Color.LIGHT_BLUE, yes);
AddChartBubble(showSessionLevels and showPWL and PWL_live and lastBar, PWL,
    "S-Liq PWL: " + Round(PWL, 2), Color.PINK, no);
```

- [ ] **Step 2: Verify tsc passes**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Verify in TOS**

Re-paste the updated `tos_indicators/liquidity_map.ts` into the TOS Liquidity_Map study editor (overwrite the previous skeleton). Save.

Reload the chart. Expected:
- Six bubbles render at the right edge of the chart: PDH, ONH, PWH in light blue (buy-side); PDL, ONL, PWL in pink (sell-side)
- The bubble label includes the price (e.g. `B-Liq PDH: 5847.50`)
- Toggle `showPDH = no` and verify only the PDH bubble disappears
- Toggle `showSessionLevels = no` and verify all six disappear

- [ ] **Step 4: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map — session level bubbles (LIVE only)

Adds PDH/PDL/ONH/ONL/PWH/PWL as right-edge chart bubbles.
Light blue for buy-side (above price), pink for sell-side (below).
Every level is always LIVE at this stage; Task 5 adds the
SWEPT/ACCEPTED state machine.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Session level lifecycle (SWEPT/ACCEPTED + arrows)

**Files:**
- Modify: `tos_indicators/liquidity_map.ts`

**Why:** Turn each session level from "always LIVE" into a real state machine. When price closes through the level, it's ACCEPTED. When price wicks through but closes back inside, it's SWEPT. Both transitions hide the bubble; only SWEPT also plots a directional arrow on the sweep bar.

- [ ] **Step 1: Replace the LIVE-only state defs with the full state machine**

In `tos_indicators/liquidity_map.ts`, find the section that currently reads:

```thinkscript
# Session-level LIVE state (always LIVE for now — Task 5 adds lifecycle).
def PDH_live = yes;
def PDL_live = yes;
def ONH_live = yes;
def ONL_live = yes;
def PWH_live = yes;
def PWL_live = yes;
```

Replace it with this lifecycle state machine. Each level gets `_accepted`, `_swept`, `_live`, and `_sweepBar` defs:

```thinkscript
# ── Session-level lifecycle state machine ────────────────────────
# Buy-side level X (above price):
#   ACCEPTED first  → close > X
#   else SWEPT      → high > X AND close <= X
#   else LIVE       → otherwise
# State latches: once transitioned, stays transitioned for the session.

def PDH_accepted = PDH_accepted[1] or (close > PDH);
def PDH_sweepBar = !PDH_accepted[1] and !PDH_swept[1] and high > PDH and close <= PDH;
def PDH_swept    = PDH_swept[1] or PDH_sweepBar;
def PDH_live     = !PDH_accepted and !PDH_swept;

def ONH_accepted = ONH_accepted[1] or (close > ONH);
def ONH_sweepBar = !ONH_accepted[1] and !ONH_swept[1] and high > ONH and close <= ONH;
def ONH_swept    = ONH_swept[1] or ONH_sweepBar;
def ONH_live     = !ONH_accepted and !ONH_swept;

def PWH_accepted = PWH_accepted[1] or (close > PWH);
def PWH_sweepBar = !PWH_accepted[1] and !PWH_swept[1] and high > PWH and close <= PWH;
def PWH_swept    = PWH_swept[1] or PWH_sweepBar;
def PWH_live     = !PWH_accepted and !PWH_swept;

# Sell-side level X (below price):
#   ACCEPTED first  → close < X
#   else SWEPT      → low < X AND close >= X
#   else LIVE       → otherwise

def PDL_accepted = PDL_accepted[1] or (close < PDL);
def PDL_sweepBar = !PDL_accepted[1] and !PDL_swept[1] and low < PDL and close >= PDL;
def PDL_swept    = PDL_swept[1] or PDL_sweepBar;
def PDL_live     = !PDL_accepted and !PDL_swept;

def ONL_accepted = ONL_accepted[1] or (close < ONL);
def ONL_sweepBar = !ONL_accepted[1] and !ONL_swept[1] and low < ONL and close >= ONL;
def ONL_swept    = ONL_swept[1] or ONL_sweepBar;
def ONL_live     = !ONL_accepted and !ONL_swept;

def PWL_accepted = PWL_accepted[1] or (close < PWL);
def PWL_sweepBar = !PWL_accepted[1] and !PWL_swept[1] and low < PWL and close >= PWL;
def PWL_swept    = PWL_swept[1] or PWL_sweepBar;
def PWL_live     = !PWL_accepted and !PWL_swept;
```

The bubble plots (`AddChartBubble(... and PDH_live and lastBar, ...)`) already check `_live`, so they automatically hide once a level transitions.

- [ ] **Step 2: Add sweep arrow plots**

Immediately after the lifecycle state machine, insert this block to plot down-arrows on buy-side sweep bars and up-arrows on sell-side sweep bars:

```thinkscript
# ── Sweep arrow plots (buy-side: down arrow above bar high) ──────
plot PDH_sweepArrow = if showSweepArrows and showSessionLevels and showPDH and PDH_sweepBar then high else Double.NaN;
PDH_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
PDH_sweepArrow.SetDefaultColor(Color.GRAY);
PDH_sweepArrow.SetLineWeight(3);

plot ONH_sweepArrow = if showSweepArrows and showSessionLevels and showONH and ONH_sweepBar then high else Double.NaN;
ONH_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
ONH_sweepArrow.SetDefaultColor(Color.GRAY);
ONH_sweepArrow.SetLineWeight(3);

plot PWH_sweepArrow = if showSweepArrows and showSessionLevels and showPWH and PWH_sweepBar then high else Double.NaN;
PWH_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
PWH_sweepArrow.SetDefaultColor(Color.GRAY);
PWH_sweepArrow.SetLineWeight(3);

# ── Sweep arrow plots (sell-side: up arrow below bar low) ────────
plot PDL_sweepArrow = if showSweepArrows and showSessionLevels and showPDL and PDL_sweepBar then low else Double.NaN;
PDL_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
PDL_sweepArrow.SetDefaultColor(Color.GRAY);
PDL_sweepArrow.SetLineWeight(3);

plot ONL_sweepArrow = if showSweepArrows and showSessionLevels and showONL and ONL_sweepBar then low else Double.NaN;
ONL_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
ONL_sweepArrow.SetDefaultColor(Color.GRAY);
ONL_sweepArrow.SetLineWeight(3);

plot PWL_sweepArrow = if showSweepArrows and showSessionLevels and showPWL and PWL_sweepBar then low else Double.NaN;
PWL_sweepArrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
PWL_sweepArrow.SetDefaultColor(Color.GRAY);
PWL_sweepArrow.SetLineWeight(3);
```

- [ ] **Step 3: Verify tsc passes**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Verify in TOS**

Re-paste the script into TOS Liquidity_Map. Save. Reload a chart with at least one full day of bars.

Expected:
- Bubbles for PDH/PDL/ONH/ONL/PWH/PWL appear *only* when the level is still LIVE (un-broken since session start)
- On any day where price already closed above PDH, the PDH bubble is invisible (ACCEPTED)
- On any day where price wicked above PDH but closed back below, a gray down-arrow appears above that exact bar
- The bubble for the swept level disappears once the sweep bar prints

Test on a recent volatile day where sweeps are likely (e.g. CPI day, FOMC day) so you can confirm sweep arrows render.

- [ ] **Step 5: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map — session level lifecycle + sweep arrows

Adds the full LIVE/SWEPT/ACCEPTED state machine for all six
session levels. Acceptance checked first (close-through), then
sweep (wick + reclaim). State latches for the session. Sweep bars
get a directional gray arrow (down for buy-side, up for sell-side);
acceptance hides the bubble silently.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Algorithmic pivots (LIVE bubbles, rolling 3 slots)

**Files:**
- Modify: `tos_indicators/liquidity_map.ts`

**Why:** Add the second liquidity source — algorithmic pivot highs and lows detected from the chart's price action. Up to 3 of each direction tracked in a rolling buffer.

- [ ] **Step 1: Add pivot detection + rolling 3-slot buffer + LIVE bubbles**

In `tos_indicators/liquidity_map.ts`, immediately after the session-level sweep arrow plots (end of Task 5's additions), insert this block:

```thinkscript
# ════════════════════════════════════════════════════════════════
#  ALGORITHMIC PIVOTS
#  Detects pivot highs/lows from price action and tracks the most
#  recent `pivotsToTrack` in each direction. Pivot confirmation lags
#  by `pivotLookback` bars (inherent to all pivot detection).
# ════════════════════════════════════════════════════════════════

# A bar is a pivot high if its high is strictly greater than the
# high of the pivotLookback bars on each side. We can only confirm
# this pivotLookback bars AFTER the swing bar, so the "pivot bar"
# we detect is actually [pivotLookback] bars in the past.

def isPivotHighConfirmed = high[pivotLookback] > Highest(high, pivotLookback)[pivotLookback + 1]
                          and high[pivotLookback] > Highest(high, pivotLookback);

def isPivotLowConfirmed  = low[pivotLookback]  < Lowest(low,  pivotLookback)[pivotLookback + 1]
                          and low[pivotLookback]  < Lowest(low,  pivotLookback);

# Roll a 3-slot buffer for buy-side pivots. When a new pivot confirms,
# shift older pivots down: slot1 = new, slot2 = old slot1, slot3 = old slot2.
def bsl1 = if isPivotHighConfirmed then high[pivotLookback] else bsl1[1];
def bsl2 = if isPivotHighConfirmed then bsl1[1]             else bsl2[1];
def bsl3 = if isPivotHighConfirmed then bsl2[1]             else bsl3[1];

# Same for sell-side pivots.
def ssl1 = if isPivotLowConfirmed then low[pivotLookback] else ssl1[1];
def ssl2 = if isPivotLowConfirmed then ssl1[1]            else ssl2[1];
def ssl3 = if isPivotLowConfirmed then ssl2[1]            else ssl3[1];

# Validity flags — a slot is valid once it has been populated at
# least once (not still NaN).
def bsl1_valid = !IsNaN(bsl1);
def bsl2_valid = !IsNaN(bsl2);
def bsl3_valid = !IsNaN(bsl3);
def ssl1_valid = !IsNaN(ssl1);
def ssl2_valid = !IsNaN(ssl2);
def ssl3_valid = !IsNaN(ssl3);

# LIVE flags — always LIVE at this stage; Task 7 adds lifecycle.
def bsl1_live = bsl1_valid;
def bsl2_live = bsl2_valid;
def bsl3_live = bsl3_valid;
def ssl1_live = ssl1_valid;
def ssl2_live = ssl2_valid;
def ssl3_live = ssl3_valid;

# ── Algorithmic-pivot bubbles (LIVE state) ───────────────────────
AddChartBubble(showAlgorithmicPivots and bsl1_live and lastBar, bsl1,
    "B-Liq P1: " + Round(bsl1, 2), Color.LIGHT_BLUE, yes);
AddChartBubble(showAlgorithmicPivots and bsl2_live and lastBar, bsl2,
    "B-Liq P2: " + Round(bsl2, 2), Color.LIGHT_BLUE, yes);
AddChartBubble(showAlgorithmicPivots and bsl3_live and lastBar, bsl3,
    "B-Liq P3: " + Round(bsl3, 2), Color.LIGHT_BLUE, yes);

AddChartBubble(showAlgorithmicPivots and ssl1_live and lastBar, ssl1,
    "S-Liq P1: " + Round(ssl1, 2), Color.PINK, no);
AddChartBubble(showAlgorithmicPivots and ssl2_live and lastBar, ssl2,
    "S-Liq P2: " + Round(ssl2, 2), Color.PINK, no);
AddChartBubble(showAlgorithmicPivots and ssl3_live and lastBar, ssl3,
    "S-Liq P3: " + Round(ssl3, 2), Color.PINK, no);
```

Note: `pivotsToTrack` is exposed as an input but the script currently hard-codes 3 slots. This is a ThinkScript limitation (no dynamic arrays); going to 4 or 5 would require duplicating each slot's variables. 3 is a reasonable trade-off for v1.

- [ ] **Step 2: Verify tsc passes**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Verify in TOS**

Re-paste the script into TOS Liquidity_Map. Save. Apply to a 5m ES chart with `pivotLookback = 5`.

Expected:
- After the first 5 bars + at least one confirmed pivot has formed, you'll see additional bubbles labeled `B-Liq P1`, `B-Liq P2`, `B-Liq P3` (or sell-side equivalents) at the right edge
- The bubbles update as new pivots form — newest pivot is always P1
- Toggle `showAlgorithmicPivots = no` and verify all six pivot bubbles disappear

- [ ] **Step 4: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map — algorithmic pivot bubbles (rolling 3)

Adds the second liquidity source: pivot highs (buy-side) and pivot
lows (sell-side) detected from price action. Rolling 3-slot buffer
in each direction so the chart shows the three most recent. Newer
pivots shift older ones down. All bubbles LIVE at this stage;
Task 7 adds lifecycle.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Algorithmic pivot lifecycle + arrows

**Files:**
- Modify: `tos_indicators/liquidity_map.ts`

**Why:** Apply the same LIVE/SWEPT/ACCEPTED state machine to algorithmic pivots that we built for session levels in Task 5. Trickier because state needs to reset when a new pivot replaces a slot.

- [ ] **Step 1: Replace the LIVE-only flags with the lifecycle state machine**

In `tos_indicators/liquidity_map.ts`, find this block from Task 6:

```thinkscript
# LIVE flags — always LIVE at this stage; Task 7 adds lifecycle.
def bsl1_live = bsl1_valid;
def bsl2_live = bsl2_valid;
def bsl3_live = bsl3_valid;
def ssl1_live = ssl1_valid;
def ssl2_live = ssl2_valid;
def ssl3_live = ssl3_valid;
```

Replace it with this lifecycle state machine. Each slot gets `_accepted`, `_swept`, `_live`, and `_sweepBar` defs. The state RESETS to LIVE whenever a new pivot replaces that slot (via the `isPivotHighConfirmed` / `isPivotLowConfirmed` reset):

```thinkscript
# ── Algorithmic pivot lifecycle (state resets when slot rolls) ────
# Buy-side slots — state latches until slot rolls.
def bsl1_accepted = if isPivotHighConfirmed then no
                   else bsl1_accepted[1] or (bsl1_valid and close > bsl1);
def bsl1_sweepBar = bsl1_valid and !bsl1_accepted[1] and !bsl1_swept[1] and high > bsl1 and close <= bsl1;
def bsl1_swept    = if isPivotHighConfirmed then no
                   else bsl1_swept[1] or bsl1_sweepBar;
def bsl1_live     = bsl1_valid and !bsl1_accepted and !bsl1_swept;

def bsl2_accepted = if isPivotHighConfirmed then bsl1_accepted[1]
                   else bsl2_accepted[1] or (bsl2_valid and close > bsl2);
def bsl2_sweepBar = bsl2_valid and !bsl2_accepted[1] and !bsl2_swept[1] and high > bsl2 and close <= bsl2;
def bsl2_swept    = if isPivotHighConfirmed then bsl1_swept[1]
                   else bsl2_swept[1] or bsl2_sweepBar;
def bsl2_live     = bsl2_valid and !bsl2_accepted and !bsl2_swept;

def bsl3_accepted = if isPivotHighConfirmed then bsl2_accepted[1]
                   else bsl3_accepted[1] or (bsl3_valid and close > bsl3);
def bsl3_sweepBar = bsl3_valid and !bsl3_accepted[1] and !bsl3_swept[1] and high > bsl3 and close <= bsl3;
def bsl3_swept    = if isPivotHighConfirmed then bsl2_swept[1]
                   else bsl3_swept[1] or bsl3_sweepBar;
def bsl3_live     = bsl3_valid and !bsl3_accepted and !bsl3_swept;

# Sell-side slots — mirror with low/close/below checks.
def ssl1_accepted = if isPivotLowConfirmed then no
                   else ssl1_accepted[1] or (ssl1_valid and close < ssl1);
def ssl1_sweepBar = ssl1_valid and !ssl1_accepted[1] and !ssl1_swept[1] and low < ssl1 and close >= ssl1;
def ssl1_swept    = if isPivotLowConfirmed then no
                   else ssl1_swept[1] or ssl1_sweepBar;
def ssl1_live     = ssl1_valid and !ssl1_accepted and !ssl1_swept;

def ssl2_accepted = if isPivotLowConfirmed then ssl1_accepted[1]
                   else ssl2_accepted[1] or (ssl2_valid and close < ssl2);
def ssl2_sweepBar = ssl2_valid and !ssl2_accepted[1] and !ssl2_swept[1] and low < ssl2 and close >= ssl2;
def ssl2_swept    = if isPivotLowConfirmed then ssl1_swept[1]
                   else ssl2_swept[1] or ssl2_sweepBar;
def ssl2_live     = ssl2_valid and !ssl2_accepted and !ssl2_swept;

def ssl3_accepted = if isPivotLowConfirmed then ssl2_accepted[1]
                   else ssl3_accepted[1] or (ssl3_valid and close < ssl3);
def ssl3_sweepBar = ssl3_valid and !ssl3_accepted[1] and !ssl3_swept[1] and low < ssl3 and close >= ssl3;
def ssl3_swept    = if isPivotLowConfirmed then ssl2_swept[1]
                   else ssl3_swept[1] or ssl3_sweepBar;
def ssl3_live     = ssl3_valid and !ssl3_accepted and !ssl3_swept;
```

- [ ] **Step 2: Add sweep arrow plots for algorithmic pivots**

Immediately after the lifecycle block, insert:

```thinkscript
# ── Algorithmic-pivot sweep arrows ───────────────────────────────
plot bsl1_arrow = if showSweepArrows and showAlgorithmicPivots and bsl1_sweepBar then high else Double.NaN;
bsl1_arrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
bsl1_arrow.SetDefaultColor(Color.GRAY);
bsl1_arrow.SetLineWeight(3);

plot bsl2_arrow = if showSweepArrows and showAlgorithmicPivots and bsl2_sweepBar then high else Double.NaN;
bsl2_arrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
bsl2_arrow.SetDefaultColor(Color.GRAY);
bsl2_arrow.SetLineWeight(3);

plot bsl3_arrow = if showSweepArrows and showAlgorithmicPivots and bsl3_sweepBar then high else Double.NaN;
bsl3_arrow.SetPaintingStrategy(PaintingStrategy.ARROW_DOWN);
bsl3_arrow.SetDefaultColor(Color.GRAY);
bsl3_arrow.SetLineWeight(3);

plot ssl1_arrow = if showSweepArrows and showAlgorithmicPivots and ssl1_sweepBar then low else Double.NaN;
ssl1_arrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
ssl1_arrow.SetDefaultColor(Color.GRAY);
ssl1_arrow.SetLineWeight(3);

plot ssl2_arrow = if showSweepArrows and showAlgorithmicPivots and ssl2_sweepBar then low else Double.NaN;
ssl2_arrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
ssl2_arrow.SetDefaultColor(Color.GRAY);
ssl2_arrow.SetLineWeight(3);

plot ssl3_arrow = if showSweepArrows and showAlgorithmicPivots and ssl3_sweepBar then low else Double.NaN;
ssl3_arrow.SetPaintingStrategy(PaintingStrategy.ARROW_UP);
ssl3_arrow.SetDefaultColor(Color.GRAY);
ssl3_arrow.SetLineWeight(3);
```

- [ ] **Step 3: Verify tsc passes**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Verify in TOS**

Re-paste into TOS. Apply to a 5m ES chart spanning a recent volatile day.

Expected:
- LIVE pivot bubbles only appear at the right edge for slots that haven't been swept or accepted
- When price wicks above a tracked pivot high and closes back inside, a gray down-arrow appears on that bar and the corresponding `B-Liq P*` bubble disappears
- Closing through a pivot (acceptance) hides the bubble silently, no arrow

- [ ] **Step 5: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map — algorithmic pivot lifecycle + arrows

Applies the LIVE/SWEPT/ACCEPTED state machine to the rolling
3-slot pivot buffer. State resets when a new pivot replaces a
slot, otherwise latches. Sweep arrows render on the exact bar.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Equal-highs / Equal-lows clustering

**Files:**
- Modify: `tos_indicators/liquidity_map.ts`

**Why:** When two or more LIVE liquidity levels of the same direction land within `equalThr` (ATR-derived) of each other, mark them as a cluster. Clusters are higher-probability hunt zones because stops compound.

- [ ] **Step 1: Add cluster detection defs**

In `tos_indicators/liquidity_map.ts`, immediately after the algorithmic-pivot sweep arrow plots, insert:

```thinkscript
# ════════════════════════════════════════════════════════════════
#  EQUAL-HIGHS / EQUAL-LOWS CLUSTERING
#  When two or more LIVE levels of the same direction land within
#  `equalThr` (ATR-derived) of each other, they form a cluster.
# ════════════════════════════════════════════════════════════════

# Helper: count how many LIVE buy-side levels exist within equalThr
# of a given target level. Includes the target itself.
script countClusterB {
    input target = 0;
    input equalThr = 0;
    input l1 = 0; input l1_live = no;
    input l2 = 0; input l2_live = no;
    input l3 = 0; input l3_live = no;
    input l4 = 0; input l4_live = no;
    input l5 = 0; input l5_live = no;
    input l6 = 0; input l6_live = no;
    input l7 = 0; input l7_live = no;
    input l8 = 0; input l8_live = no;
    input l9 = 0; input l9_live = no;
    plot count = (if l1_live and AbsValue(target - l1) <= equalThr then 1 else 0)
               + (if l2_live and AbsValue(target - l2) <= equalThr then 1 else 0)
               + (if l3_live and AbsValue(target - l3) <= equalThr then 1 else 0)
               + (if l4_live and AbsValue(target - l4) <= equalThr then 1 else 0)
               + (if l5_live and AbsValue(target - l5) <= equalThr then 1 else 0)
               + (if l6_live and AbsValue(target - l6) <= equalThr then 1 else 0)
               + (if l7_live and AbsValue(target - l7) <= equalThr then 1 else 0)
               + (if l8_live and AbsValue(target - l8) <= equalThr then 1 else 0)
               + (if l9_live and AbsValue(target - l9) <= equalThr then 1 else 0);
}

# For each buy-side level, count how many OTHER buy-side levels
# cluster with it. ≥2 total (target + at least 1 other) = cluster.
def PDH_clusterCount = countClusterB(PDH, equalThr,
    ONH, ONH_live, PWH, PWH_live,
    bsl1, bsl1_live, bsl2, bsl2_live, bsl3, bsl3_live,
    0, no, 0, no, 0, no, 0, no);

def ONH_clusterCount = countClusterB(ONH, equalThr,
    PDH, PDH_live, PWH, PWH_live,
    bsl1, bsl1_live, bsl2, bsl2_live, bsl3, bsl3_live,
    0, no, 0, no, 0, no, 0, no);

def PWH_clusterCount = countClusterB(PWH, equalThr,
    PDH, PDH_live, ONH, ONH_live,
    bsl1, bsl1_live, bsl2, bsl2_live, bsl3, bsl3_live,
    0, no, 0, no, 0, no, 0, no);

def bsl1_clusterCount = countClusterB(bsl1, equalThr,
    PDH, PDH_live, ONH, ONH_live, PWH, PWH_live,
    bsl2, bsl2_live, bsl3, bsl3_live,
    0, no, 0, no, 0, no, 0, no);

def bsl2_clusterCount = countClusterB(bsl2, equalThr,
    PDH, PDH_live, ONH, ONH_live, PWH, PWH_live,
    bsl1, bsl1_live, bsl3, bsl3_live,
    0, no, 0, no, 0, no, 0, no);

def bsl3_clusterCount = countClusterB(bsl3, equalThr,
    PDH, PDH_live, ONH, ONH_live, PWH, PWH_live,
    bsl1, bsl1_live, bsl2, bsl2_live,
    0, no, 0, no, 0, no, 0, no);

# Same for sell-side. Note the script body is identical — only the
# input semantics differ. Reuse the same script with sell-side data.
def PDL_clusterCount = countClusterB(PDL, equalThr,
    ONL, ONL_live, PWL, PWL_live,
    ssl1, ssl1_live, ssl2, ssl2_live, ssl3, ssl3_live,
    0, no, 0, no, 0, no, 0, no);

def ONL_clusterCount = countClusterB(ONL, equalThr,
    PDL, PDL_live, PWL, PWL_live,
    ssl1, ssl1_live, ssl2, ssl2_live, ssl3, ssl3_live,
    0, no, 0, no, 0, no, 0, no);

def PWL_clusterCount = countClusterB(PWL, equalThr,
    PDL, PDL_live, ONL, ONL_live,
    ssl1, ssl1_live, ssl2, ssl2_live, ssl3, ssl3_live,
    0, no, 0, no, 0, no, 0, no);

def ssl1_clusterCount = countClusterB(ssl1, equalThr,
    PDL, PDL_live, ONL, ONL_live, PWL, PWL_live,
    ssl2, ssl2_live, ssl3, ssl3_live,
    0, no, 0, no, 0, no, 0, no);

def ssl2_clusterCount = countClusterB(ssl2, equalThr,
    PDL, PDL_live, ONL, ONL_live, PWL, PWL_live,
    ssl1, ssl1_live, ssl3, ssl3_live,
    0, no, 0, no, 0, no, 0, no);

def ssl3_clusterCount = countClusterB(ssl3, equalThr,
    PDL, PDL_live, ONL, ONL_live, PWL, PWL_live,
    ssl1, ssl1_live, ssl2, ssl2_live,
    0, no, 0, no, 0, no, 0, no);
```

- [ ] **Step 2: Update bubble plots to use cluster-aware labels**

Find every `AddChartBubble(...)` call that was added in Task 4 and Task 6 (12 calls total). For each one, modify the label string to prefix with `Equal: ` when its cluster count is ≥ 1 (meaning ≥1 OTHER level is within threshold).

Replace each existing bubble with the cluster-aware version. For PDH:

```thinkscript
AddChartBubble(showSessionLevels and showPDH and PDH_live and lastBar, PDH,
    (if showEqualClusterLabels and PDH_clusterCount >= 1 then "Equal: " else "") +
    "B-Liq PDH: " + Round(PDH, 2),
    if PDH_clusterCount >= 1 then Color.CYAN else Color.LIGHT_BLUE,
    yes);
```

Apply the same transformation to: PDL, ONH, ONL, PWH, PWL, bsl1, bsl2, bsl3, ssl1, ssl2, ssl3. For each one:
- Replace the original bubble call
- Change the label prefix from `""` to `(if showEqualClusterLabels and X_clusterCount >= 1 then "Equal: " else "")`
- Change the color from `Color.LIGHT_BLUE` or `Color.PINK` to `if X_clusterCount >= 1 then Color.CYAN else Color.LIGHT_BLUE` (buy-side) or `if X_clusterCount >= 1 then Color.MAGENTA else Color.PINK` (sell-side)

Sell-side example for PDL:

```thinkscript
AddChartBubble(showSessionLevels and showPDL and PDL_live and lastBar, PDL,
    (if showEqualClusterLabels and PDL_clusterCount >= 1 then "Equal: " else "") +
    "S-Liq PDL: " + Round(PDL, 2),
    if PDL_clusterCount >= 1 then Color.MAGENTA else Color.PINK,
    no);
```

(Why CYAN/MAGENTA: these are brighter shades of the same hue families — they make clusters visually unmistakable without introducing a new color family.)

- [ ] **Step 3: Verify tsc passes**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 4: Verify in TOS**

Re-paste into TOS. Apply to a chart where you can identify a cluster (e.g. PDH and ONH within a few points of each other — common when overnight range is tight).

Expected:
- When two LIVE levels of the same direction sit within `equalATRMult × ATR` of each other, both bubbles show `Equal: ` prefix and switch to the bolder cluster color (cyan for buy-side, magenta for sell-side)
- When only one level is LIVE in that area, no Equal prefix and the regular light-blue/pink color
- Toggle `showEqualClusterLabels = no` and verify the prefix and color change disappear (label content reverts to plain `B-Liq PDH: ...`)

- [ ] **Step 5: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map — equal-highs/lows clustering

Detects when 2+ LIVE liquidity levels of the same direction sit
within equalATRMult × ATR of each other. Clustered bubbles get
"Equal:" prefix and a brighter color (cyan for buy-side, magenta
for sell-side). Cluster detection is symmetric — each level
counts its peers; ≥1 peer in range = cluster member.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Corner labels (Live counts + Nearest target)

**Files:**
- Modify: `tos_indicators/liquidity_map.ts`

**Why:** Two persistent corner labels that summarize the liquidity map at a glance. Live count tells you the balance of un-hunted liquidity above vs below; Nearest target tells you the next price level price is heading toward.

- [ ] **Step 1: Add corner label computations + plot**

In `tos_indicators/liquidity_map.ts`, immediately after the bubble plots updated in Task 8, insert:

```thinkscript
# ════════════════════════════════════════════════════════════════
#  CORNER LABELS
# ════════════════════════════════════════════════════════════════

def liveB = (if PDH_live then 1 else 0)
          + (if ONH_live then 1 else 0)
          + (if PWH_live then 1 else 0)
          + (if bsl1_live then 1 else 0)
          + (if bsl2_live then 1 else 0)
          + (if bsl3_live then 1 else 0);

def liveS = (if PDL_live then 1 else 0)
          + (if ONL_live then 1 else 0)
          + (if PWL_live then 1 else 0)
          + (if ssl1_live then 1 else 0)
          + (if ssl2_live then 1 else 0)
          + (if ssl3_live then 1 else 0);

# Color: balanced ≥2 each = green, heavy imbalance = yellow, one side empty = red
def balanceColor_val =
    if liveB == 0 or liveS == 0 then 0       # red
    else if (liveB >= 4 and liveS <= 1) or (liveS >= 4 and liveB <= 1) then 1  # yellow
    else 2;                                  # green

AddLabel(showCornerSummary,
    "Liq Live: B " + liveB + " / S " + liveS,
    if balanceColor_val == 0 then Color.RED
    else if balanceColor_val == 1 then Color.YELLOW
    else Color.GREEN);

# Distance to nearest LIVE liquidity. We compute the closest above
# and closest below independently, then pick whichever is closer.
def distAbovePDH = if PDH_live and PDH > close then PDH - close else Double.POSITIVE_INFINITY;
def distAboveONH = if ONH_live and ONH > close then ONH - close else Double.POSITIVE_INFINITY;
def distAbovePWH = if PWH_live and PWH > close then PWH - close else Double.POSITIVE_INFINITY;
def distAboveB1  = if bsl1_live and bsl1 > close then bsl1 - close else Double.POSITIVE_INFINITY;
def distAboveB2  = if bsl2_live and bsl2 > close then bsl2 - close else Double.POSITIVE_INFINITY;
def distAboveB3  = if bsl3_live and bsl3 > close then bsl3 - close else Double.POSITIVE_INFINITY;
def nearestAbove = Min(Min(Min(distAbovePDH, distAboveONH), Min(distAbovePWH, distAboveB1)), Min(distAboveB2, distAboveB3));

def distBelowPDL = if PDL_live and PDL < close then close - PDL else Double.POSITIVE_INFINITY;
def distBelowONL = if ONL_live and ONL < close then close - ONL else Double.POSITIVE_INFINITY;
def distBelowPWL = if PWL_live and PWL < close then close - PWL else Double.POSITIVE_INFINITY;
def distBelowS1  = if ssl1_live and ssl1 < close then close - ssl1 else Double.POSITIVE_INFINITY;
def distBelowS2  = if ssl2_live and ssl2 < close then close - ssl2 else Double.POSITIVE_INFINITY;
def distBelowS3  = if ssl3_live and ssl3 < close then close - ssl3 else Double.POSITIVE_INFINITY;
def nearestBelow = Min(Min(Min(distBelowPDL, distBelowONL), Min(distBelowPWL, distBelowS1)), Min(distBelowS2, distBelowS3));

def nearestDir   = if nearestAbove <= nearestBelow then 1 else -1;  # 1=above, -1=below
def nearestDist  = if nearestDir == 1 then nearestAbove else nearestBelow;

# Name of the nearest level — first match wins, in priority order.
AddLabel(showCornerSummary and !IsNaN(nearestDist) and nearestDist < Double.POSITIVE_INFINITY,
    "Nearest: " +
    (if nearestDir == 1 then
        (if distAbovePDH == nearestAbove then "PDH"
         else if distAboveONH == nearestAbove then "ONH"
         else if distAbovePWH == nearestAbove then "PWH"
         else if distAboveB1 == nearestAbove then "B-P1"
         else if distAboveB2 == nearestAbove then "B-P2"
         else "B-P3")
     else
        (if distBelowPDL == nearestBelow then "PDL"
         else if distBelowONL == nearestBelow then "ONL"
         else if distBelowPWL == nearestBelow then "PWL"
         else if distBelowS1 == nearestBelow then "S-P1"
         else if distBelowS2 == nearestBelow then "S-P2"
         else "S-P3")) +
    " " + (if nearestDir == 1 then "+" else "-") + Round(nearestDist, 2) + " pts " +
    (if nearestDir == 1 then "↑" else "↓"),
    if nearestDir == 1 then Color.LIGHT_BLUE else Color.PINK);
```

- [ ] **Step 2: Verify tsc passes**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Verify in TOS**

Re-paste into TOS. Apply to a live ES chart.

Expected:
- Two new corner labels appear: `Liq Live: B X / S Y` and `Nearest: <NAME> +Z.ZZ pts ↑`
- As price moves through the day and levels get hunted, the live counts decrement
- The "Nearest" label updates every bar to point to the closest LIVE liquidity in either direction

- [ ] **Step 4: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map — corner labels

Two summary labels in the chart corner: count of LIVE buy-side
vs sell-side liquidity (color-coded by balance), and distance to
the nearest un-hunted level by name + direction. Compensates for
the lineless design — you can read approach distance from the
label rather than seeing a line extend across the chart.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Alerts (sweep, approach, cluster forming)

**Files:**
- Modify: `tos_indicators/liquidity_map.ts`

**Why:** Audible feedback for actionable events. Sweeps and equal-cluster formations are the most actionable; approach alerts are gentle "look at the chart" chimes.

- [ ] **Step 1: Add alert calls**

In `tos_indicators/liquidity_map.ts`, immediately after the corner labels block, insert:

```thinkscript
# ════════════════════════════════════════════════════════════════
#  ALERTS
# ════════════════════════════════════════════════════════════════

# Buy-side sweep — any of the buy-side levels just got swept.
def anyBuySideSweep = PDH_sweepBar or ONH_sweepBar or PWH_sweepBar
                    or bsl1_sweepBar or bsl2_sweepBar or bsl3_sweepBar;
Alert(inSession and anyBuySideSweep,
    "Liquidity Map: Buy-side sweep — reversal context", Alert.BAR, Sound.Ring);

# Sell-side sweep
def anySellSideSweep = PDL_sweepBar or ONL_sweepBar or PWL_sweepBar
                     or ssl1_sweepBar or ssl2_sweepBar or ssl3_sweepBar;
Alert(inSession and anySellSideSweep,
    "Liquidity Map: Sell-side sweep — reversal context", Alert.BAR, Sound.Ding);

# Approach — price within approachThr of any LIVE liquidity. Fires
# once on entry to the zone (not every bar) by gating on prior bar
# NOT being in the zone.
def inApproachZone =
    (PDH_live  and AbsValue(close - PDH)  <= approachThr) or
    (PDL_live  and AbsValue(close - PDL)  <= approachThr) or
    (ONH_live  and AbsValue(close - ONH)  <= approachThr) or
    (ONL_live  and AbsValue(close - ONL)  <= approachThr) or
    (PWH_live  and AbsValue(close - PWH)  <= approachThr) or
    (PWL_live  and AbsValue(close - PWL)  <= approachThr) or
    (bsl1_live and AbsValue(close - bsl1) <= approachThr) or
    (bsl2_live and AbsValue(close - bsl2) <= approachThr) or
    (bsl3_live and AbsValue(close - bsl3) <= approachThr) or
    (ssl1_live and AbsValue(close - ssl1) <= approachThr) or
    (ssl2_live and AbsValue(close - ssl2) <= approachThr) or
    (ssl3_live and AbsValue(close - ssl3) <= approachThr);
Alert(inSession and showApproachAlerts and inApproachZone and !inApproachZone[1],
    "Liquidity Map: Approaching liquidity", Alert.BAR, Sound.Bell);

# Equal-cluster formation — fires when ANY level's clusterCount
# transitions from 0 to ≥1.
def anyClusterFormation =
    (PDH_clusterCount >= 1 and PDH_clusterCount[1] == 0) or
    (PDL_clusterCount >= 1 and PDL_clusterCount[1] == 0) or
    (ONH_clusterCount >= 1 and ONH_clusterCount[1] == 0) or
    (ONL_clusterCount >= 1 and ONL_clusterCount[1] == 0) or
    (PWH_clusterCount >= 1 and PWH_clusterCount[1] == 0) or
    (PWL_clusterCount >= 1 and PWL_clusterCount[1] == 0) or
    (bsl1_clusterCount >= 1 and bsl1_clusterCount[1] == 0) or
    (bsl2_clusterCount >= 1 and bsl2_clusterCount[1] == 0) or
    (bsl3_clusterCount >= 1 and bsl3_clusterCount[1] == 0) or
    (ssl1_clusterCount >= 1 and ssl1_clusterCount[1] == 0) or
    (ssl2_clusterCount >= 1 and ssl2_clusterCount[1] == 0) or
    (ssl3_clusterCount >= 1 and ssl3_clusterCount[1] == 0);
Alert(inSession and showEqualClusterLabels and anyClusterFormation,
    "Liquidity Map: Equal-highs/lows cluster formed", Alert.BAR, Sound.Chimes);
```

- [ ] **Step 2: Verify tsc passes**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: Verify in TOS**

Re-paste into TOS. Make sure TOS sound alerts are enabled (Setup → Application Settings → Sounds → make sure events fire audio).

Expected:
- A buy-side sweep fires `Sound.Ring`
- A sell-side sweep fires `Sound.Ding`
- Price entering within `approachATRMult × ATR` of any LIVE level (when transitioning in, not while sitting in) fires `Sound.Bell`
- A new equal-cluster forming fires `Sound.Chimes`

Test live by setting `pivotLookback = 3` (more frequent pivots) and watching during a session.

- [ ] **Step 4: Commit**

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map — alerts (sweep, approach, cluster)

Four alert types: buy-side sweep (Ring), sell-side sweep (Ding),
approach to any LIVE liquidity (Bell), and equal-cluster formation
(Chimes). All gated on inSession. Approach alert fires only on
zone entry, not every bar inside the zone, to avoid spam.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Multi-ticker smoke test + sync repo file

**Files:**
- (potentially) Modify: `tos_indicators/liquidity_map.ts`

**Why:** Final cross-instrument verification. Confirm ATR-based thresholds actually scale correctly between ES, NQ, MES, MNQ, and a stock. If you spot any bugs in real use, fix them now and re-sync the repo file.

- [ ] **Step 1: Test on /ES (5m chart, RTH)**

Apply Liquidity_Map to a /ES 5m chart during RTH (08:30–15:00 CT). Verify:
- LIVE bubbles appear for un-hunted session levels
- Pivot bubbles appear ~`pivotLookback` × 5min = 25 minutes after a visible swing
- Equal-cluster forms when overnight high and prior day high are close (≤ ~3 points apart, since ES daily ATR is ~25 and 0.15 × 25 ≈ 3.75)
- Sweep arrows render when stops get run
- Corner labels accurate: counts match visible bubbles, nearest distance matches eyeball

- [ ] **Step 2: Test on /NQ (5m chart, RTH)**

Switch the chart to /NQ. Verify:
- All thresholds scale up — equal-cluster threshold is now ~22 points on NQ (since NQ daily ATR ≈ 150, and 0.15 × 150 ≈ 22)
- You're not seeing false-positive clusters every 3 points (that would mean the ATR scaling failed)
- Approach alerts fire at the right distance (should feel similar to ES proportionally)

- [ ] **Step 3: Test overnight (`sessionGating = no`, default)**

Pick any time outside RTH (after 15:00 CT or before 08:30 CT on a futures day). Verify:
- All bubbles, arrows, alerts continue to function
- ONH/ONL still reflect the *previous* overnight window (not the current night)

- [ ] **Step 4: Test session gating ON**

Set `sessionGating = yes`. Verify:
- Outside 08:30–15:00 CT, the indicator becomes invisible (no bubbles, no arrows, no alerts)
- Inside the window, behavior matches Step 1

- [ ] **Step 5: If you modified the script in TOS during testing, sync back to repo**

If during testing you found a bug or tweaked a value and edited the script in TOS, paste the final corrected version back into `tos_indicators/liquidity_map.ts`. Then:

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: passes.

If you made changes:

```bash
git -C /Users/shawndeeboyd/es-trading-journal add tos_indicators/liquidity_map.ts
git -C /Users/shawndeeboyd/es-trading-journal commit -m "$(cat <<'EOF'
TOS: Liquidity Map — post-smoke-test corrections

<describe what was wrong + how it was fixed>

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If no changes were needed, no commit. The indicator is shipped.

---

## Final verification

After all 11 tasks are complete:

- [ ] **Type-check clean:**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Lint clean:**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npm run lint
```

Expected: zero new warnings (the unrelated `reports/page.tsx` cleanup from prior work has already settled it).

- [ ] **Production build green:**

```bash
cd /Users/shawndeeboyd/es-trading-journal && npm run build
```

Expected: build succeeds. (`tos_indicators` is excluded — no compilation attempted on the ThinkScript files.)

- [ ] **Files committed:**

```bash
git -C /Users/shawndeeboyd/es-trading-journal log --oneline | head -15
```

You should see commits for Tasks 1–10 (plus optionally Task 11), all on `main`. Two new files in the repo: `tos_indicators/firelines.ts` and `tos_indicators/liquidity_map.ts`, plus `tos_indicators/README.md`, plus the `tsconfig.json` edit.

- [ ] **End-to-end smoke check:**

Open ES 5m chart. Layer FireLines + Liquidity_Map. Both indicators render together without visual collision. Liquidity bubbles appear at the right edge; FireLines lines and labels appear as before. The two indicators are visually distinguishable by color family (FireLines: green/red/yellow/white/cyan/magenta/orange; Liquidity Map: light blue/pink/cyan/magenta accents).
