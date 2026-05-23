# Liquidity Map — ICT-Style Liquidity Indicator for ThinkOrSwim

**Status:** Approved — ready for implementation plan
**Date:** 2026-05-23

## Summary

A new ThinkScript indicator that marks where stop clusters sit (buy-side liquidity above swing highs, sell-side below swing lows) and watches them get hunted in real time. Layers alongside FireLines on the same chart as an independent indicator.

The visual design is **lineless** — every liquidity level renders as a right-edge chart bubble at its price, not as a horizontal line extending across the candles. Sweep events get arrow markers on the exact bar where the sweep happened. This keeps the chart readable when stacked on top of FireLines (which already has 12+ lines).

The indicator is fully **ticker-agnostic** (ATR-based thresholds scale automatically across ES/NQ/MES/MNQ/SPY) and **timeframe-agnostic** (pivot lookback exposed as a tunable input with per-timeframe guidance), and runs 24/7 by default so it works for Globex traders.

## Conceptual Model

**Two sources of liquidity, one map:**

- **Algorithmic intraday pivots** — N-bar pivot highs (buy-side) and pivot lows (sell-side), tracked as fresh liquidity forms during the session
- **Session levels** — PDH/PDL, ONH/ONL, PWH/PWL — static reference liquidity computed at session start

**Three lifecycle states per level:**

| State | Meaning | Visual |
|---|---|---|
| LIVE | Un-hunted, still relevant | Bright sky-blue (buy-side) or pink (sell-side) bubble at right edge |
| SWEPT | Wicked through + closed back inside (ICT-classic stop hunt — reversal context) | Bubble disappears + arrow marker on the sweep bar |
| ACCEPTED | Closed cleanly through (continuation context) | Bubble disappears, no marker |

**Relationship to FireLines:** Independent indicator, layered on the same chart. FireLines tells you "where price math says it wants to react." Liquidity Map tells you "where stops are sitting and getting hunted." Cross-confluence between the two is eyeball-detected for v1.

## Inputs

```thinkscript
# ── Detection parameters ─────────────────────────────────────────
input pivotLookback           = 5;       # bars on each side for swing detection
input pivotsToTrack           = 3;       # max algorithmic pivots per direction
input equalATRMult            = 0.15;    # equal-highs within 0.15 × ATR(14)
input approachATRMult         = 0.25;    # approach alert within 0.25 × ATR(14)
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
input sessionGating           = no;      # 24/7 by default
input sessionStartHHMM        = 0830;    # only used when gating=yes
input sessionEndHHMM          = 1500;    # only used when gating=yes
```

## Source 1 — Algorithmic Pivots

**Detection rule:** A bar qualifies as a pivot high if its high is strictly greater than the high of the N bars on each side (N = `pivotLookback`). Same logic mirrored for pivot lows.

**Confirmation lag:** Pivots can't be confirmed until N bars *after* the swing bar. This is inherent to all pivot-based detection. A pivot high that printed at 09:35 on a 5m chart with `pivotLookback = 5` won't appear as liquidity until 10:00 CT.

**Tracking:** Up to `pivotsToTrack = 3` pivots in each direction. When a 4th forms, the oldest scrolls off regardless of state.

**Per-timeframe tuning suggestions (documented in the script header):**

| Chart | Suggested `pivotLookback` |
|---|---|
| 1m  | 10–15 (filter noise) |
| 5m  | 5–7 (default range) |
| 15m | 3–5 |
| 1H  | 3 |

## Source 2 — Session Levels

Six static levels, each computed once at session boundary and persistent for the day:

| Level | Definition | Computation |
|---|---|---|
| PDH | Prior Day High | `high(period = DAY)[1]` |
| PDL | Prior Day Low | `low(period = DAY)[1]` |
| ONH | Overnight High (prior overnight window) | highest price during the most recently completed 17:00 prev day → 08:30 today CT window |
| ONL | Overnight Low (prior overnight window) | lowest price during same window |
| PWH | Prior Week High | `high(period = WEEK)[1]` |
| PWL | Prior Week Low | `low(period = WEEK)[1]` |

Each gets its own `showX` toggle for selective viewing.

**ONH/ONL note for night traders:** These reference the *previous* overnight window, not the current one. At 22:00 CT on Tuesday, ONH/ONL = Monday night's range. To hide them during Globex sessions, toggle `showONH = no` and `showONL = no`.

## Lifecycle: Sweep vs Acceptance Detection

For each liquidity level at price X, every bar is evaluated in this priority:

| Direction | First: ACCEPTED if... | Else: SWEPT if... | Else: stays LIVE |
|---|---|---|---|
| Buy-side (X above) | `close > X` | `high > X` AND `close ≤ X` | otherwise |
| Sell-side (X below) | `close < X` | `low < X` AND `close ≥ X` | otherwise |

Acceptance is checked first. If a bar closes through the level, that's acceptance — even if it wicked first. Only a wick *without* a close-through is a sweep.

**Permanent transition:** Once a level transitions away from LIVE, the state is permanent for the session. Price returning doesn't "un-sweep" the line — the stops were already grabbed.

## Equal-highs / Equal-lows Clustering

When two or more LIVE liquidity levels of the same direction land within `equalATRMult × ATR` of each other (e.g. 0.15 × 25-point ATR = 3.75 points on ES), they form a cluster:

- **Each** clustered bubble continues to render at its own price (no merging), but with `Equal: ` prefix (or `3x: ` for triple-stacks)
- Cluster bubbles render larger / bolder than non-clustered ones
- One-time alert fires when the cluster forms (not per-bar repeats)

The detection runs every bar so clusters update dynamically as new pivots form or existing levels are consumed.

## Visual Treatment (Lineless)

**Nothing draws horizontal lines across the chart.** Every visual element is anchored to specific bars.

| Element | When | Where | Style |
|---|---|---|---|
| LIVE bubble (buy-side) | Level is LIVE | Right edge bubble at level's price | Sky blue, `B-Liq: 5847.50` |
| LIVE bubble (sell-side) | Level is LIVE | Right edge bubble at level's price | Pink, `S-Liq: 5830.25` |
| Equal-cluster bubble | 2+ LIVE levels within threshold | Right edge bubble at cluster price | Brighter shade, `Equal: 5847.50` or `3x: 5847.50` |
| Buy-side sweep arrow | Bar where buy-side sweep occurs | Above the bar's high | ↓ arrow, gray |
| Sell-side sweep arrow | Bar where sell-side sweep occurs | Below the bar's low | ↑ arrow, gray |
| Sweep history | After sweep | (no persistent line — arrow is the marker) | Arrow only |
| Acceptance | After acceptance | (no marker) | Bubble simply disappears |

**Color rationale:** Sky blue and pink are *not* used by FireLines (which owns green, red, yellow, white, cyan, magenta, orange). At a glance you can tell which indicator a visual element belongs to.

## Corner Labels

Two persistent corner labels when `showCornerSummary = yes`:

**Live counts**
```
Liq Live: B 3 / S 2
```
Colored by balance:
- Both ≥2 → green (balanced map)
- Heavy imbalance (4+ on one side, 0–1 on other) → yellow
- One side empty → red (all hunted on that side; high pressure to reverse)

**Nearest target**
```
Nearest: PDH +4.25 pts ↑
```
Updates every bar. Shows distance to the nearest LIVE liquidity and the side. The arrow indicates whether you'd have to go up (↑) or down (↓) to reach it.

## Alerts

| Event | Sound | Rationale |
|---|---|---|
| Buy-side sweep | `Sound.Ring` | Reversal context — most actionable |
| Sell-side sweep | `Sound.Ding` | Same urgency, different pitch for direction |
| Approach (within `approachATRMult × ATR`) | `Sound.Bell` | "Look at the chart" |
| Equal-cluster forms | `Sound.Chimes` | Rare, distinct sound |
| Acceptance | *(no alert)* | Continuation isn't surprising; would be noisy |

All alerts respect the session gate when enabled.

## Ticker / Timeframe / Time Agnostic Design

**Ticker-agnostic** — All distance thresholds (`equalATRMult`, `approachATRMult`) are multipliers of daily ATR, so they scale automatically:

| Instrument | Daily ATR (approx) | `0.15 × ATR` (equal threshold) |
|---|---|---|
| ES | ~25 points | ~3.75 |
| NQ | ~150 points | ~22 |
| MES | ~25 points | ~3.75 |
| MNQ | ~150 points | ~22 |
| SPY | ~3 points | ~0.45 |

**Timeframe-agnostic** — `pivotLookback` is exposed as an input. The script ships with header documentation suggesting values per timeframe.

**Time-agnostic** — `sessionGating` defaults to `no`. The indicator runs 24/7 on futures, supporting overnight Globex sessions. RTH-only view is one input toggle away.

## Files Delivered

```
tos_indicators/
  ├── liquidity_map.ts        # NEW — Liquidity Map indicator
  └── firelines.ts            # NEW — backup of current FireLines indicator
                              #       (including the recent per-level confluence labels)
```

Both files are pure reference copies — TOS reads the script from its own study editor, not from the filesystem. The files in the repo serve as:
- Version-controlled backups (recoverable if TOS data is lost)
- Source of truth for future Claude/Codex sessions that need to modify the scripts
- Documentation for what's deployed

Note: Files use `.ts` extension because ThinkScript files conventionally use `.ts` in TOS exports. This won't conflict with TypeScript build because they're outside the Next.js `app/`, `components/`, `lib/`, `types/` directories — Next.js won't try to compile them.

## Out of Scope (YAGNI)

- **Cross-confluence with FireLines** — programmatic detection of FL-level-at-liquidity-zone. v1 leaves this to eyeball detection.
- **Multi-symbol scanning** — single chart, single instrument only.
- **Custom liquidity types** — no FVG fills, order blocks, breaker blocks, or other ICT primitives. Just swing-based liquidity + session levels.
- **Volume-confirmed sweeps** — sweep detection is pure price action; doesn't gate on volume.
- **Historical backtesting** — no backtest stats or hit-rate analysis baked into the indicator. (That would be a separate Python/journal feature, per the existing roadmap memory file `project_firelines_roadmap.md`.)
- **Cross-confluence label** — no equivalent of FireLines' "⚡ N confluences" corner summary across indicators.

## Verification Plan

Manual UI verification in TOS per project convention. After implementation:

1. Paste `liquidity_map.ts` into TOS Studies → Create New Study → save.
2. Apply to an ES /MES 5-minute chart during RTH. Verify:
   - PDH, PDL, ONH, ONL, PWH, PWL bubbles render at expected prices
   - Toggling `showPDH = no` removes that one bubble only
   - Algorithmic pivot bubbles appear ~5 bars after a visible swing
   - Equal-highs bubble appears when two pivots cluster within ATR-derived threshold
3. Wait for a sweep event (or simulate by changing `pivotLookback` to force a recent pivot, then watch for resolution):
   - Sweep produces a gray arrow on the exact sweep bar
   - LIVE bubble disappears at the same time
   - Audible alert fires
4. Wait for an acceptance event (or move chart to a day where price closed clearly above PDH):
   - Bubble disappears
   - No arrow marker
   - No alert
5. Switch chart to NQ. Verify the `equalATRMult × ATR` thresholds produce reasonable equal-cluster behavior (clusters should form at ~22-point separations on NQ, not 3-point).
6. Switch to a Globex chart at night (after 17:00 CT). Verify the indicator continues operating (since `sessionGating = no` by default).
7. Toggle `sessionGating = yes` and verify visuals disappear outside 08:30–15:00 CT.
8. Save the final script text to `tos_indicators/liquidity_map.ts` in the repo and verify the file commits cleanly without affecting the Next.js build (`npm run build` should still pass).
9. Save the current production FireLines script to `tos_indicators/firelines.ts`. Verify same — commits cleanly, no Next.js impact.

The gating check is the same as for the Next.js app: `npx tsc --noEmit` should pass after creating the `tos_indicators/` directory, since TypeScript's `include` paths in `tsconfig.json` don't reach into that directory.
