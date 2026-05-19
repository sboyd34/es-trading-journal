# Replay Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the blind backtest from a static-cutoff snapshot into a bar-by-bar Mode B ("trigger-puller") playback engine with a 5-pillar checklist gate and a mistake taxonomy.

**Architecture:** Add two new phases (`checklist`, `playback`) to the BlindBacktestClient state machine. Extract three new leaf components (PreTradeChecklist, PlaybackControls, MistakeSelector). Refactor CandlestickChart to support incremental visible-bar updates without re-initializing on every bar. Add one Supabase migration with 5 new columns. Reuse the existing `calculateOutcome` helper for per-bar stop/target detection during playback.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind, Supabase (`@supabase/ssr`), lightweight-charts, lucide-react, react-hot-toast.

**Verification model (per project convention in CLAUDE.md):** No automated test suite. Each task is gated by `npx tsc --noEmit` (must pass with zero errors) and explicit manual UI walk-throughs in the dev browser. Commit only after both gates pass.

**Reference spec:** [docs/superpowers/specs/2026-05-18-replay-engine-design.md](../specs/2026-05-18-replay-engine-design.md)

---

## Task 1: Database migration + types

**Files:**
- Create: `supabase/replay_engine_migration.sql`
- Modify: `types/index.ts:237-268`

- [ ] **Step 1: Write the migration**

Create `supabase/replay_engine_migration.sql`:

```sql
-- ============================================================
-- Replay Engine — adds bar-by-bar playback + mistake taxonomy
-- Run once in Supabase SQL editor
-- ============================================================

ALTER TABLE blind_backtest_trades
  ADD COLUMN IF NOT EXISTS mistake_type    TEXT,
  ADD COLUMN IF NOT EXISTS mistake_other   TEXT,
  ADD COLUMN IF NOT EXISTS bars_held       INTEGER,
  ADD COLUMN IF NOT EXISTS entry_bar_index INTEGER,
  ADD COLUMN IF NOT EXISTS playback_mode   TEXT NOT NULL DEFAULT 'B';
```

- [ ] **Step 2: Apply migration in Supabase dashboard**

Open the Supabase project → SQL Editor → paste the contents of `supabase/replay_engine_migration.sql` → click Run. Confirm "Success. No rows returned." Note application in session carryover.

- [ ] **Step 3: Extend the `BlindBacktestTrade` interface**

In `types/index.ts`, modify the `BlindBacktestTrade` interface (currently lines 237-268) by adding these 5 fields just before `chart_url`:

```typescript
  mistake_type:    string | null
  mistake_other:   string | null
  bars_held:       number | null
  entry_bar_index: number | null
  playback_mode:   'A' | 'B'
```

- [ ] **Step 4: Type-check**

Run from `/Users/shawndeeboyd/es-trading-journal`:

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/replay_engine_migration.sql types/index.ts
git commit -m "$(cat <<'EOF'
Replay: migration and type extensions for playback + mistakes

Adds mistake_type, mistake_other, bars_held, entry_bar_index, and
playback_mode columns to blind_backtest_trades. Existing rows default
to playback_mode='B' (closest match to current instant-outcome behavior).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: API route persists new fields

**Files:**
- Modify: `app/api/blind-backtest/trades/route.ts:14-75`

- [ ] **Step 1: Extend the POST handler destructure**

In `app/api/blind-backtest/trades/route.ts`, after line 41 (after `chart_url,`), add to the destructure:

```typescript
      mistake_type,
      mistake_other,
      bars_held,
      entry_bar_index,
      playback_mode,
```

- [ ] **Step 2: Extend the insert call**

In the same file, after the `chart_url,` line in the `.insert({...})` block (around line 74), add:

```typescript
        mistake_type,
        mistake_other,
        bars_held,
        entry_bar_index,
        playback_mode: playback_mode ?? 'B',
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Smoke test the route**

Start the dev server (`npm run dev`), log in, then in a browser devtools console run:

```javascript
fetch('/api/blind-backtest/trades', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    historical_date: '2025-01-02',
    chart_cutoff_time: '10:00',
    entry_price: 5000, stop_price: 4998, target_price: 5004,
    direction: 'long',
    mistake_type: 'Clean — no mistake, just a loss',
    playback_mode: 'B',
    bars_held: 12,
    entry_bar_index: 18,
  }),
}).then(r => r.json()).then(console.log)
```

Expected: response contains `trade` object with the new fields populated. Open Supabase Table Editor on `blind_backtest_trades` and visually confirm the row landed with all 5 new columns set. Then delete the test row.

- [ ] **Step 5: Commit**

```bash
git add app/api/blind-backtest/trades/route.ts
git commit -m "$(cat <<'EOF'
Replay: persist mistake taxonomy and playback metadata

Extends POST /api/blind-backtest/trades to accept and store the five
new columns introduced in the replay engine migration.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: PreTradeChecklist component

**Files:**
- Create: `components/blind-backtest/PreTradeChecklist.tsx`

- [ ] **Step 1: Create the component**

Create `components/blind-backtest/PreTradeChecklist.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Check, Lock } from 'lucide-react'

const SETUPS = ['ORB', 'TTM Squeeze', 'AVWAP', 'FVG', 'Divergence'] as const

export interface ChecklistValues {
  bias: string
  setup: string
  trigger: string
  location: string
  entryPrice: string
  stopPrice: string
  targetPrice: string
  direction: 'long' | 'short' | ''
  confidence: string
}

export const EMPTY_CHECKLIST: ChecklistValues = {
  bias: '', setup: '', trigger: '', location: '',
  entryPrice: '', stopPrice: '', targetPrice: '',
  direction: '', confidence: '',
}

interface Props {
  values: ChecklistValues
  onChange: (next: ChecklistValues) => void
  onStartPlayback: () => void
  disabled?: boolean
}

function isFilled(v: string) {
  return v.trim().length > 0
}

function numericFilled(v: string) {
  return isFilled(v) && Number.isFinite(parseFloat(v))
}

export default function PreTradeChecklist({ values, onChange, onStartPlayback, disabled }: Props) {
  const pillars = useMemo(() => {
    const riskFilled = numericFilled(values.entryPrice) && numericFilled(values.stopPrice) && numericFilled(values.targetPrice)
    return [
      { key: 'bias',      label: '1. Bias',     ok: isFilled(values.bias) },
      { key: 'setup',     label: '2. Setup',    ok: isFilled(values.setup) },
      { key: 'trigger',   label: '3. Trigger',  ok: isFilled(values.trigger) },
      { key: 'location',  label: '4. Location', ok: isFilled(values.location) },
      { key: 'risk',      label: '5. Risk (entry/stop/target)', ok: riskFilled },
    ]
  }, [values])

  const allValid = pillars.every((p) => p.ok) && (values.direction === 'long' || values.direction === 'short')

  function update<K extends keyof ChecklistValues>(key: K, val: ChecklistValues[K]) {
    onChange({ ...values, [key]: val })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-gray-300">
          <Lock className="h-4 w-4" />
          <span>Cannot state all five = no trade. Period.</span>
        </div>
        <ul className="space-y-1 text-sm">
          {pillars.map((p) => (
            <li key={p.key} className={cn('flex items-center gap-2', p.ok ? 'text-emerald-400' : 'text-gray-500')}>
              <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded border', p.ok ? 'border-emerald-400 bg-emerald-400/10' : 'border-gray-600')}>
                {p.ok && <Check className="h-3 w-3" />}
              </span>
              {p.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Bias (1H direction)</span>
          <input
            type="text"
            value={values.bias}
            onChange={(e) => update('bias', e.target.value)}
            placeholder="bull / bear / neutral + reasoning"
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Setup</span>
          <select
            value={values.setup}
            onChange={(e) => update('setup', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          >
            <option value="">— choose —</option>
            {SETUPS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs text-gray-400">Trigger (5m signal)</span>
          <input
            type="text"
            value={values.trigger}
            onChange={(e) => update('trigger', e.target.value)}
            placeholder="break, retest, confirm…"
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs text-gray-400">Location</span>
          <input
            type="text"
            value={values.location}
            onChange={(e) => update('location', e.target.value)}
            placeholder="approved location, room to target"
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Direction</span>
          <select
            value={values.direction}
            onChange={(e) => update('direction', e.target.value as ChecklistValues['direction'])}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          >
            <option value="">— choose —</option>
            <option value="long">long</option>
            <option value="short">short</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Confidence (1–5)</span>
          <input
            type="number" min="1" max="5"
            value={values.confidence}
            onChange={(e) => update('confidence', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Entry</span>
          <input
            type="number" step="0.25"
            value={values.entryPrice}
            onChange={(e) => update('entryPrice', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Stop</span>
          <input
            type="number" step="0.25"
            value={values.stopPrice}
            onChange={(e) => update('stopPrice', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Target</span>
          <input
            type="number" step="0.25"
            value={values.targetPrice}
            onChange={(e) => update('targetPrice', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={!allValid || !!disabled}
        onClick={onStartPlayback}
        className={cn(
          'w-full rounded-lg py-3 text-sm font-medium transition',
          allValid
            ? 'bg-emerald-500 text-white hover:bg-emerald-400'
            : 'cursor-not-allowed bg-gray-800 text-gray-500'
        )}
      >
        {allValid ? 'Start Playback — Trade Is Live' : `Fill all 5 pillars + direction to continue`}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. (Component is not yet imported anywhere — that's fine, tsc still checks it.)

- [ ] **Step 3: Commit**

```bash
git add components/blind-backtest/PreTradeChecklist.tsx
git commit -m "$(cat <<'EOF'
Replay: PreTradeChecklist component for 5-pillar gate

Renders the bias/setup/trigger/location/risk discipline check as an
explicit visual gate. The 'Start Playback' button is disabled until
all five pillars + direction are valid — no bypass affordance.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: PlaybackControls component

**Files:**
- Create: `components/blind-backtest/PlaybackControls.tsx`

- [ ] **Step 1: Create the component**

Create `components/blind-backtest/PlaybackControls.tsx`:

```tsx
'use client'

import { cn } from '@/lib/utils'
import { Play, Pause, SkipForward, X } from 'lucide-react'

export type PlaybackSpeed = 0.5 | 1 | 2 | 5

export const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 5]

interface Props {
  playing: boolean
  speed: PlaybackSpeed
  currentBar: number
  totalBars: number
  onTogglePlay: () => void
  onSpeedChange: (s: PlaybackSpeed) => void
  onStep: () => void
  onBail: () => void
}

export default function PlaybackControls({
  playing, speed, currentBar, totalBars,
  onTogglePlay, onSpeedChange, onStep, onBail,
}: Props) {
  const progressPct = totalBars > 0 ? Math.min(100, (currentBar / totalBars) * 100) : 0

  return (
    <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-900/50 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePlay}
          className="inline-flex items-center gap-1.5 rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-400"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playing ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          onClick={onStep}
          disabled={playing}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium',
            playing
              ? 'cursor-not-allowed bg-gray-800 text-gray-500'
              : 'bg-gray-700 text-gray-100 hover:bg-gray-600'
          )}
        >
          <SkipForward className="h-4 w-4" />
          Step
        </button>

        <div className="ml-2 flex items-center gap-1">
          <span className="text-xs text-gray-400">Speed</span>
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              className={cn(
                'rounded px-2 py-1 text-xs font-medium',
                speed === s
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              )}
            >
              {s}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onBail}
          className="ml-auto inline-flex items-center gap-1.5 rounded bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20"
        >
          <X className="h-4 w-4" />
          Bail
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Bar {currentBar} of {totalBars}</span>
          <span>{progressPct.toFixed(0)}% through session</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add components/blind-backtest/PlaybackControls.tsx
git commit -m "$(cat <<'EOF'
Replay: PlaybackControls component for play/pause/speed/step/bail

Pure-UI control surface for the playback phase. Speed selector covers
0.5x through 5x; Step is enabled only while paused; Bail emits a
SCRATCH outcome without forcing the user to wait out the full session.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: MistakeSelector component

**Files:**
- Create: `components/blind-backtest/MistakeSelector.tsx`

- [ ] **Step 1: Create the component**

Create `components/blind-backtest/MistakeSelector.tsx`:

```tsx
'use client'

import { cn } from '@/lib/utils'

export const MISTAKE_TYPES = [
  'Outside time window',
  'Broke checklist (claimed pillars I didn\'t actually verify)',
  'No setup confluence',
  'Chased entry (price ran before I clicked)',
  'Held loser past mental stop',
  'Cut winner too early',
  'FOMO — wasn\'t really my setup',
  'Clean — no mistake, just a loss',
  'Other',
] as const

export type MistakeType = typeof MISTAKE_TYPES[number]

interface Props {
  value: MistakeType | ''
  otherText: string
  onValueChange: (v: MistakeType | '') => void
  onOtherChange: (t: string) => void
}

export default function MistakeSelector({ value, otherText, onValueChange, onOtherChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-400">What broke down? (Be honest — &quot;Clean&quot; is a valid answer.)</div>
      <div className="space-y-1">
        {MISTAKE_TYPES.map((m) => (
          <label
            key={m}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded border p-2 text-sm transition',
              value === m
                ? 'border-blue-500 bg-blue-500/10 text-gray-100'
                : 'border-gray-700 bg-gray-900/50 text-gray-400 hover:border-gray-600'
            )}
          >
            <input
              type="radio"
              name="mistake-type"
              checked={value === m}
              onChange={() => onValueChange(m)}
              className="mt-0.5"
            />
            <span>{m}</span>
          </label>
        ))}
      </div>
      {value === 'Other' && (
        <textarea
          value={otherText}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Describe the mistake…"
          rows={2}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add components/blind-backtest/MistakeSelector.tsx
git commit -m "$(cat <<'EOF'
Replay: MistakeSelector with explicit mistake taxonomy

Radio group rendered in the grading phase. The 'Clean' option exists
deliberately — losing trades are not always mistakes, and tracking
the difference teaches when to refine vs accept variance.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: CandlestickChart incremental rendering

**Why:** Naively passing `fullCandles.slice(0, replayIndex + 1)` would re-create the chart on every bar advance (the existing `useEffect` keys on the `candles` array reference). At 5× speed that's a 5-Hz chart rebuild — flicker and lost scroll position. The fix is one-time chart init + incremental `series.setData()` calls keyed on `visibleCount`.

**Files:**
- Modify: `components/blind-backtest/CandlestickChart.tsx` (whole file rewrite — small file, easier to replace than to edit)

- [ ] **Step 1: Replace the file contents**

Replace `components/blind-backtest/CandlestickChart.tsx` with:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { computeVWAP, computeEMA } from '@/lib/indicators'

export interface Candle {
  t: number  // Unix seconds (UTC)
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface IndicatorPrefs {
  vwap: boolean
  ema9: boolean
  ema20: boolean
  ema21: boolean
  ema50: boolean
}

interface Props {
  candles: Candle[]
  visibleCount?: number       // if provided, render only the first N candles; defaults to candles.length
  entryPrice?: number
  stopPrice?: number
  targetPrice?: number
  exitPrice?: number
  cutoffTimestamp?: number
  entryTimestamp?: number
  exitTimestamp?: number
  direction?: 'long' | 'short'
  indicators?: IndicatorPrefs
  height?: number
}

async function loadLib() {
  return await import('lightweight-charts')
}

export default function CandlestickChart({
  candles,
  visibleCount,
  entryPrice,
  stopPrice,
  targetPrice,
  exitPrice,
  cutoffTimestamp,
  entryTimestamp,
  exitTimestamp,
  direction,
  indicators,
  height = 380,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Awaited<ReturnType<typeof initChart>> | null>(null)

  // Effect A — initialize chart once per (candles reference, indicator config, height)
  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return
    let cleanedUp = false

    async function setup() {
      const handle = await initChart(containerRef.current!, candles, {
        height, indicators, entryPrice, stopPrice, targetPrice, exitPrice,
        cutoffTimestamp, entryTimestamp, exitTimestamp, direction,
      })
      if (cleanedUp) {
        handle?.chart.remove()
        return
      }
      chartRef.current = handle
      // Apply initial visibleCount if provided
      if (handle && visibleCount !== undefined && visibleCount < candles.length) {
        const sliced = candles.slice(0, Math.max(1, visibleCount))
        handle.series.setData(sliced.map(toLightweightCandle))
      }
    }

    setup()

    return () => {
      cleanedUp = true
      chartRef.current?.chart.remove()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, height,
      indicators?.vwap, indicators?.ema9, indicators?.ema20, indicators?.ema21, indicators?.ema50,
      entryPrice, stopPrice, targetPrice, exitPrice,
      cutoffTimestamp, entryTimestamp, exitTimestamp, direction])

  // Effect B — incremental visibleCount updates (no chart rebuild)
  useEffect(() => {
    const handle = chartRef.current
    if (!handle || visibleCount === undefined) return
    const n = Math.max(1, Math.min(visibleCount, candles.length))
    handle.series.setData(candles.slice(0, n).map(toLightweightCandle))
  }, [visibleCount, candles])

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full rounded-lg overflow-hidden bg-gray-900/40"
    />
  )
}

function toLightweightCandle(c: Candle) {
  return { time: c.t as unknown as import('lightweight-charts').Time, open: c.o, high: c.h, low: c.l, close: c.c }
}

async function initChart(
  el: HTMLDivElement,
  candles: Candle[],
  opts: {
    height: number
    indicators?: IndicatorPrefs
    entryPrice?: number
    stopPrice?: number
    targetPrice?: number
    exitPrice?: number
    cutoffTimestamp?: number
    entryTimestamp?: number
    exitTimestamp?: number
    direction?: 'long' | 'short'
  }
) {
  const { createChart, ColorType, LineStyle, CrosshairMode } = await loadLib()

  const chart = createChart(el, {
    width: el.clientWidth,
    height: opts.height,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: '#9ca3af',
    },
    grid: {
      vertLines: { color: '#1f2937', style: LineStyle.Dotted },
      horzLines: { color: '#1f2937', style: LineStyle.Dotted },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#4b5563', labelBackgroundColor: '#374151' },
      horzLine: { color: '#4b5563', labelBackgroundColor: '#374151' },
    },
    rightPriceScale: { borderColor: '#374151', textColor: '#9ca3af' },
    timeScale: {
      borderColor: '#374151',
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (ts: number) => new Date(ts * 1000).toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false,
      }),
    },
    localization: {
      timeFormatter: (ts: number) => new Date(ts * 1000).toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false,
      }),
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  })

  const series = chart.addCandlestickSeries({
    upColor: '#10b981', downColor: '#ef4444',
    borderUpColor: '#10b981', borderDownColor: '#ef4444',
    wickUpColor: '#10b981', wickDownColor: '#ef4444',
  })

  series.setData(candles.map(toLightweightCandle))

  if (opts.indicators) {
    type LineCfg = { key: keyof IndicatorPrefs; color: string; title: string; values: (number | null)[] }
    const overlays: LineCfg[] = []
    if (opts.indicators.vwap)  overlays.push({ key: 'vwap',  color: '#facc15', title: 'VWAP',   values: computeVWAP(candles) })
    if (opts.indicators.ema9)  overlays.push({ key: 'ema9',  color: '#22d3ee', title: 'EMA 9',  values: computeEMA(candles, 9) })
    if (opts.indicators.ema20) overlays.push({ key: 'ema20', color: '#60a5fa', title: 'EMA 20', values: computeEMA(candles, 20) })
    if (opts.indicators.ema21) overlays.push({ key: 'ema21', color: '#f472b6', title: 'EMA 21', values: computeEMA(candles, 21) })
    if (opts.indicators.ema50) overlays.push({ key: 'ema50', color: '#fb923c', title: 'EMA 50', values: computeEMA(candles, 50) })

    for (const o of overlays) {
      const line = chart.addLineSeries({
        color: o.color, lineWidth: 2,
        priceLineVisible: false, lastValueVisible: true, title: o.title,
      })
      const data = candles
        .map((c, i) => ({ time: c.t as unknown as import('lightweight-charts').Time, value: o.values[i] }))
        .filter((d): d is { time: import('lightweight-charts').Time; value: number } => d.value != null)
      line.setData(data)
    }
  }

  if (opts.entryPrice !== undefined) {
    series.createPriceLine({ price: opts.entryPrice, color: '#3b82f6', lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: opts.direction === 'long' ? '▲ Entry' : '▼ Entry' })
  }
  if (opts.stopPrice !== undefined) {
    series.createPriceLine({ price: opts.stopPrice, color: '#ef4444', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop' })
  }
  if (opts.targetPrice !== undefined) {
    series.createPriceLine({ price: opts.targetPrice, color: '#10b981', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Target' })
  }
  if (opts.exitPrice !== undefined) {
    series.createPriceLine({ price: opts.exitPrice, color: '#a78bfa', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'Exit' })
  }

  const markers: {
    time: import('lightweight-charts').Time
    position: 'aboveBar' | 'belowBar'
    color: string
    shape: 'arrowDown' | 'arrowUp' | 'circle' | 'square'
    text: string
  }[] = []
  if (opts.cutoffTimestamp !== undefined) {
    markers.push({ time: opts.cutoffTimestamp as unknown as import('lightweight-charts').Time, position: 'aboveBar', color: '#f59e0b', shape: 'arrowDown', text: 'Entry window' })
  }
  if (opts.entryTimestamp !== undefined) {
    markers.push({
      time: opts.entryTimestamp as unknown as import('lightweight-charts').Time,
      position: opts.direction === 'long' ? 'belowBar' : 'aboveBar',
      color: '#3b82f6',
      shape: opts.direction === 'long' ? 'arrowUp' : 'arrowDown',
      text: 'Entry',
    })
  }
  if (opts.exitTimestamp !== undefined) {
    markers.push({ time: opts.exitTimestamp as unknown as import('lightweight-charts').Time, position: 'aboveBar', color: '#a78bfa', shape: 'circle', text: 'Exit' })
  }
  if (markers.length > 0) {
    markers.sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number))
    series.setMarkers(markers)
  }

  chart.timeScale().fitContent()

  const observer = new ResizeObserver(() => {
    chart.applyOptions({ width: el.clientWidth })
  })
  observer.observe(el)

  return { chart, series, observer }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Manual visual check**

Start the dev server (`npm run dev`), navigate to the existing blind backtest, run one session through to the **charting** phase. Verify the chart still renders correctly with all current behavior (cutoff arrow, price lines on reveal, indicator overlays). Nothing about visible UX should have changed — only the internals.

- [ ] **Step 4: Commit**

```bash
git add components/blind-backtest/CandlestickChart.tsx
git commit -m "$(cat <<'EOF'
Replay: CandlestickChart supports incremental visible-bar updates

Splits chart init from data updates. A new visibleCount prop lets the
parent stream bars in without rebuilding the chart on every advance —
necessary for smooth bar-by-bar playback at 1x-5x speeds.

Behavior with no visibleCount prop is unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Wire the playback phase into BlindBacktestClient

This is the biggest task. One file, many surgical changes, single commit at the end. The file must stay buildable throughout — work top-down through these steps.

**Files:**
- Modify: `components/blind-backtest/BlindBacktestClient.tsx`

- [ ] **Step 1: Extend the Phase union**

Find the type alias near line 25:

```typescript
type Phase = 'home' | 'session-setup' | 'charting' | 'reveal' | 'grading' | 'complete'
```

Replace with:

```typescript
type Phase = 'home' | 'session-setup' | 'charting' | 'checklist' | 'playback' | 'reveal' | 'grading' | 'complete'
```

- [ ] **Step 2: Add imports**

Near the top, add to the existing imports:

```typescript
import PreTradeChecklist, { ChecklistValues, EMPTY_CHECKLIST } from './PreTradeChecklist'
import PlaybackControls, { PlaybackSpeed } from './PlaybackControls'
import MistakeSelector, { MistakeType } from './MistakeSelector'
```

- [ ] **Step 3: Add the playback state block**

After the existing "Grading phase" state block (around line 235, after `const [saving, setSaving] = useState(false)`), insert:

```typescript
  // Checklist phase — replaces the old free-form TradeForm
  const [checklist, setChecklist] = useState<ChecklistValues>(EMPTY_CHECKLIST)

  // Playback phase
  const [replayIndex, setReplayIndex] = useState(0)         // current visible bar index in fullCandles
  const [entryBarIndex, setEntryBarIndex] = useState(0)     // bar at which trade went live
  const [playbackPlaying, setPlaybackPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1)

  // Grading additions
  const [mistakeType, setMistakeType] = useState<MistakeType | ''>('')
  const [mistakeOther, setMistakeOther] = useState('')
```

- [ ] **Step 4: Add the playback timer effect**

Anywhere in the component body after the state declarations but before the `return`, add:

```typescript
  // Playback loop — advances replayIndex while playing, halts on stop/target/end
  useEffect(() => {
    if (phase !== 'playback' || !playbackPlaying || !chartData) return

    const intervalMs = 1000 / playbackSpeed
    const id = window.setInterval(() => {
      setReplayIndex((prev) => {
        const next = prev + 1
        if (next >= chartData.fullCandles.length) {
          // End of session — resolve and move to reveal
          window.setTimeout(() => resolveAndReveal(chartData.fullCandles.length - 1), 0)
          return chartData.fullCandles.length - 1
        }
        // Check stop/target on this new bar
        const entry  = parseFloat(checklist.entryPrice)
        const stop   = parseFloat(checklist.stopPrice)
        const target = parseFloat(checklist.targetPrice)
        const c = chartData.fullCandles[next]
        const dir = checklist.direction
        const stopHit = dir === 'long' ? c.l <= stop : c.h >= stop
        const targetHit = dir === 'long' ? c.h >= target : c.l <= target
        if (stopHit || targetHit) {
          window.setTimeout(() => resolveAndReveal(next), 0)
        }
        return next
      })
    }, intervalMs)

    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, playbackPlaying, playbackSpeed, chartData])
```

- [ ] **Step 5: Add the resolve-and-reveal helper**

Just above the playback effect, add:

```typescript
  const resolveAndReveal = useCallback((finalBarIndex: number) => {
    if (!chartData) return
    setPlaybackPlaying(false)
    // Slice from entry bar through final bar for outcome calc
    const afterEntry = chartData.fullCandles.slice(entryBarIndex, finalBarIndex + 1)
    const entry  = parseFloat(checklist.entryPrice)
    const stop   = parseFloat(checklist.stopPrice)
    const target = parseFloat(checklist.targetPrice)
    const result = calculateOutcome(afterEntry, entry, stop, target, checklist.direction, config.contractType)
    setOutcome(result)
    setPhase('reveal')
  }, [chartData, entryBarIndex, checklist, config.contractType])
```

- [ ] **Step 6: Add the bail handler**

After the resolve-and-reveal helper, add:

```typescript
  const handleBail = useCallback(() => {
    if (!chartData) return
    setPlaybackPlaying(false)
    const c = chartData.fullCandles[replayIndex]
    const entry = parseFloat(checklist.entryPrice)
    const stop  = parseFloat(checklist.stopPrice)
    const pv = config.contractType === 'MES' ? 5 : 50
    const pnl  = checklist.direction === 'long' ? (c.c - entry) * pv : (entry - c.c) * pv
    const risk = Math.abs(entry - stop) * pv
    setOutcome({
      outcome: 'SCRATCH', exitPrice: c.c, grossPnl: pnl, rMultiple: risk > 0 ? pnl / risk : 0,
      mfe: 0, mae: 0,
    })
    setPhase('reveal')
  }, [chartData, replayIndex, checklist, config.contractType])
```

- [ ] **Step 7: Add the step handler**

Just below `handleBail`, add:

```typescript
  const handleStep = useCallback(() => {
    if (!chartData) return
    setReplayIndex((prev) => {
      const next = Math.min(prev + 1, chartData.fullCandles.length - 1)
      const entry  = parseFloat(checklist.entryPrice)
      const stop   = parseFloat(checklist.stopPrice)
      const target = parseFloat(checklist.targetPrice)
      const c = chartData.fullCandles[next]
      const dir = checklist.direction
      const stopHit = dir === 'long' ? c.l <= stop : c.h >= stop
      const targetHit = dir === 'long' ? c.h >= target : c.l <= target
      if (stopHit || targetHit || next === chartData.fullCandles.length - 1) {
        window.setTimeout(() => resolveAndReveal(next), 0)
      }
      return next
    })
  }, [chartData, checklist, resolveAndReveal])
```

- [ ] **Step 8: Add the start-playback handler**

After `handleStep`, add:

```typescript
  const handleStartPlayback = useCallback(() => {
    if (!chartData) return
    const startIdx = chartData.cutoffIndex
    setEntryBarIndex(startIdx)
    setReplayIndex(startIdx)
    setPlaybackPlaying(true)
    setPhase('playback')
  }, [chartData])
```

- [ ] **Step 9: Find the existing "Place Trade" submit handler and route it to checklist phase**

Search for the existing trade-form submit (likely a button that triggers something like `handleSubmitTrade` or inline logic that calls `calculateOutcome` and transitions to `'reveal'`). The function may be named differently — search for `setPhase('reveal')` or `calculateOutcome(`.

Replace its body so that instead of going directly to outcome calculation, it transitions to the new `checklist` phase, seeding the checklist from any in-flight form values:

```typescript
  const goToChecklist = useCallback(() => {
    setChecklist({
      bias: form.bias,
      setup: form.setup,
      trigger: form.trigger,
      location: form.location,
      entryPrice: form.entryPrice,
      stopPrice: form.stopPrice,
      targetPrice: form.targetPrice,
      direction: (form.direction === 'long' || form.direction === 'short') ? form.direction : '',
      confidence: form.confidence,
    })
    setPhase('checklist')
  }, [form])
```

Wire the existing "Place Trade" / submit button's `onClick` to call `goToChecklist` instead of its current handler.

- [ ] **Step 10: Render the checklist phase**

Find the existing phase-router (the part of the JSX that branches on `phase`). After the `'charting'` branch, add:

```tsx
      {phase === 'checklist' && chartData && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-700 bg-gray-900/30 p-3 text-sm text-gray-300">
            Reading complete. Lock your plan — when you hit play, the trade is live.
          </div>
          <PreTradeChecklist
            values={checklist}
            onChange={setChecklist}
            onStartPlayback={handleStartPlayback}
          />
        </div>
      )}
```

- [ ] **Step 11: Render the playback phase**

After the checklist branch, add:

```tsx
      {phase === 'playback' && chartData && (
        <div className="space-y-3">
          <CandlestickChart
            candles={chartData.fullCandles}
            visibleCount={replayIndex + 1}
            entryPrice={parseFloat(checklist.entryPrice)}
            stopPrice={parseFloat(checklist.stopPrice)}
            targetPrice={parseFloat(checklist.targetPrice)}
            cutoffTimestamp={chartData.fullCandles[entryBarIndex]?.t}
            direction={checklist.direction === 'long' || checklist.direction === 'short' ? checklist.direction : undefined}
            indicators={indicatorPrefs}
          />
          <PlaybackControls
            playing={playbackPlaying}
            speed={playbackSpeed}
            currentBar={replayIndex - entryBarIndex}
            totalBars={chartData.fullCandles.length - entryBarIndex - 1}
            onTogglePlay={() => setPlaybackPlaying((p) => !p)}
            onSpeedChange={setPlaybackSpeed}
            onStep={handleStep}
            onBail={handleBail}
          />
        </div>
      )}
```

- [ ] **Step 12: Render MistakeSelector inside the grading phase**

Find the existing `'grading'` branch in the JSX. Inside its layout, add a new section near the self-grade and notes inputs:

```tsx
          <div className="space-y-2">
            <MistakeSelector
              value={mistakeType}
              otherText={mistakeOther}
              onValueChange={setMistakeType}
              onOtherChange={setMistakeOther}
            />
          </div>
```

- [ ] **Step 13: Include new fields in the save payload**

Find the save call inside the grading-phase submit handler (search for the POST to `/api/blind-backtest/trades`). Add to the JSON body:

```typescript
        mistake_type: mistakeType || null,
        mistake_other: mistakeType === 'Other' ? (mistakeOther || null) : null,
        bars_held: replayIndex - entryBarIndex,
        entry_bar_index: entryBarIndex,
        playback_mode: 'B',
```

- [ ] **Step 14: Reset new state on session reset / next trade**

Find the function(s) that reset between trades and between sessions (likely named `nextTrade`, `resetSession`, or `goHome`). Add to each:

```typescript
    setChecklist(EMPTY_CHECKLIST)
    setReplayIndex(0)
    setEntryBarIndex(0)
    setPlaybackPlaying(false)
    setPlaybackSpeed(1)
    setMistakeType('')
    setMistakeOther('')
```

- [ ] **Step 15: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. Fix any reported issues inline — most likely candidates are unused variable warnings (remove dead state), or missing destructure imports.

- [ ] **Step 16: End-to-end manual UI walk-through**

Start dev server (`npm run dev`), navigate to blind backtest. Run a **full session of at least 2 trades** with the following checks:

1. Start session → chart loads at cutoff ✓
2. Click "Place Trade" → transitions to checklist phase ✓
3. Try clicking "Start Playback" with empty pillars → button disabled, text reads correctly ✓
4. Fill in bias/setup/trigger/location/entry/stop/target/direction → all five pillars light up green ✓
5. Click "Start Playback" → transitions to playback phase, chart visible, controls render ✓
6. Click Play → bars start advancing visibly ✓
7. Change speed to 2× → advance visibly faster ✓
8. Pause → bars freeze ✓
9. Click Step → exactly one bar advances ✓
10. Set a stop very close to entry to force a hit → playback auto-halts, transitions to reveal ✓
11. In grading, select a mistake type → radio works, "Clean" works, "Other" reveals textarea ✓
12. Submit → trade persists, in Supabase Table Editor confirm new columns populated ✓
13. Start trade #2, this time click Bail mid-playback → outcome is SCRATCH, transitions to reveal ✓

If any step fails, do NOT commit — fix and re-test.

- [ ] **Step 17: Commit**

```bash
git add components/blind-backtest/BlindBacktestClient.tsx
git commit -m "$(cat <<'EOF'
Replay: bar-by-bar playback phase wired into blind backtest

Adds 'checklist' and 'playback' phases to the state machine. Checklist
gates trade plan submission behind a 5-pillar discipline check.
Playback streams bars from the cutoff forward, with play/pause/speed/
step/bail controls. Outcome resolves on stop hit, target hit, end of
session, or user bail. New fields (mistake_type, bars_held,
entry_bar_index, playback_mode) flow through the save payload.

Mode B only for v1. Mode A (Planner) is deferred to a future spec.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: StatsView — Mistakes Breakdown

**Files:**
- Modify: `components/blind-backtest/StatsView.tsx`

- [ ] **Step 1: Read the file to find the rendering pattern**

```bash
sed -n '1,80p' components/blind-backtest/StatsView.tsx
```

Identify how existing breakdown sections (e.g., "By Setup", "By Time Window") are structured. Match that pattern for the new section so it looks native.

- [ ] **Step 2: Add the Mistakes Breakdown section**

Inside `StatsView`, after the last existing breakdown section, add:

```tsx
{(() => {
  const tradesWithMistake = trades.filter((t) => t.mistake_type)
  if (tradesWithMistake.length === 0) return null

  const byMistake = new Map<string, { count: number; rSum: number; rCount: number }>()
  for (const t of tradesWithMistake) {
    const key = t.mistake_type ?? 'Unknown'
    const existing = byMistake.get(key) ?? { count: 0, rSum: 0, rCount: 0 }
    existing.count++
    if (t.r_multiple != null) {
      existing.rSum += t.r_multiple
      existing.rCount++
    }
    byMistake.set(key, existing)
  }
  const rows = Array.from(byMistake.entries())
    .map(([k, v]) => ({ key: k, count: v.count, avgR: v.rCount > 0 ? v.rSum / v.rCount : null }))
    .sort((a, b) => b.count - a.count)

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
      <h3 className="mb-3 text-sm font-medium text-gray-300">Mistakes Breakdown</h3>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="text-left font-normal">Mistake</th>
            <th className="text-right font-normal">Count</th>
            <th className="text-right font-normal">Avg R</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-800">
              <td className="py-1.5 text-gray-200">{r.key}</td>
              <td className="py-1.5 text-right text-gray-300">{r.count}</td>
              <td className={`py-1.5 text-right ${r.avgR == null ? 'text-gray-500' : r.avgR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {r.avgR == null ? '—' : r.avgR.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})()}
```

(If the `trades` variable in this component is named differently, e.g. `allTrades` or `data`, rename accordingly. The component already receives the trade list as a prop — match the existing name.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Manual UI check**

Navigate to the blind backtest Stats tab. The new "Mistakes Breakdown" section should appear only after at least one trade with a `mistake_type` exists (the silent-when-clean convention from CLAUDE.md). If you have no such trades yet, run a quick replay trade through Task 7's flow to seed one, then re-check.

- [ ] **Step 5: Commit**

```bash
git add components/blind-backtest/StatsView.tsx
git commit -m "$(cat <<'EOF'
Replay: Mistakes Breakdown section in StatsView

Renders count and average R-multiple per mistake_type, sorted by
frequency. Silent-when-clean — section is omitted entirely when no
trades have been tagged yet.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Full session end-to-end verification

No code changes. This is the gating check before declaring Spec 1 done.

- [ ] **Step 1: Run a complete 3-trade replay session**

Start dev server. Walk through all 13 sub-checks from Task 7 Step 16 across at least 3 trades, varying:
- One that hits target (WIN)
- One that hits stop (LOSS)
- One you bail on (SCRATCH)

For each trade, select a different `mistake_type` (including "Clean" for one).

- [ ] **Step 2: Verify the stats page reflects the new session**

After completing the session, navigate to the Stats tab. Confirm:
- Total trade count incremented by 3
- Win/loss/scratch counts match what you executed
- Mistakes Breakdown shows the 3 mistake types you selected, with counts of 1 each
- Average R per mistake type matches the trades

- [ ] **Step 3: Verify persistence**

Open Supabase Table Editor → `blind_backtest_trades`. Find your 3 new rows. Confirm:
- `mistake_type` populated correctly
- `bars_held` is a positive integer
- `entry_bar_index` is a positive integer
- `playback_mode` is `'B'`

- [ ] **Step 4: Run the production-grade gating check**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

All three must succeed. The build step catches issues `tsc --noEmit` misses (route resolution, dynamic imports, etc).

- [ ] **Step 5: Mark Spec 1 complete**

If all checks pass, Spec 1 is done. Note completion in session carryover. Spec 2 (FireLines Port + Overlay) is the next session.

---

## Notes

- **No automated tests** — this matches project convention. When a test framework is added in the future, this plan's verification steps convert cleanly to `it('does X', () => ...)` cases.
- **`requestAnimationFrame` vs `setInterval`** — the spec mentions rAF as a mitigation against interval drift. For v1, `setInterval` is acceptable; at 1× = 1 bar/second, drift is imperceptible. If 5× speed feels jittery in practice, swap to rAF in a follow-up.
- **Out of scope reminders** — FireLines overlay, real ES data, Mode A. Do NOT scope-creep these in.
