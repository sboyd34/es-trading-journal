// MAE/MFE excursion math + loss classification.
// Excursions are computed from Polygon 1-min bars and stored in TICKS.
// Pure functions here; the API route (app/api/trades/enrich-excursions) owns
// the fetching, rate limiting, and DB writes.

import type { PolygonCandle } from '@/lib/polygon-chart'

// MES/ES tick = 0.25 index points (tick value $1.25 on MES, $12.50 on ES).
export const TICK_SIZE = 0.25

// Only ES and MES trades map onto MES price bars — both track the same S&P 500
// e-mini price series at the same 0.25 tick. NQ/MNQ trade a different index, so
// MES bars would be meaningless; those are marked 'no_data' instead.
export const EXCURSION_INSTRUMENTS = new Set(['ES', 'MES'])

// Front-month MES contract on Polygon. Futures roll quarterly (Mar/Jun/Sep/Dec),
// so this MUST be updated each roll — override with POLYGON_MES_TICKER without a
// redeploy. Verify the exact symbol against Polygon's futures symbology.
export const MES_FRONT_MONTH_TICKER = process.env.POLYGON_MES_TICKER || 'MESU2026'

// A reversal loss is a losing trade that first ran this many ticks green.
export const REVERSAL_LOSS_MFE_TICKS = 8

export type ExcursionSource =
  | 'polygon_1min'
  | 'polygon_1min_edgebar'
  | 'spy_proxy'
  | 'spy_proxy_edgebar'
export type LossType = 'straight_loss' | 'reversal_loss'

// SPY stands in for S&P 500 futures when no direct futures feed is available.
// Override with POLYGON_PROXY_TICKER if the entitlement changes.
export const SPY_PROXY_TICKER = process.env.POLYGON_PROXY_TICKER || 'SPY'

export interface ExcursionResult {
  mae_ticks: number
  mfe_ticks: number
  excursion_source: ExcursionSource
}

function priceToTicks(points: number): number {
  // Floor at 0: a trade that never traveled that direction has 0 excursion.
  return Math.max(0, Math.round(points / TICK_SIZE))
}

/**
 * Direction-aware MAE/MFE from the bars spanning entry→exit (inclusive).
 * Returns null when there are no bars to measure.
 */
export function computeExcursions(
  direction: 'long' | 'short',
  entryPrice: number,
  candles: PolygonCandle[],
): ExcursionResult | null {
  if (candles.length === 0) return null

  let lowestLow = Infinity
  let lowestLowIdx = 0
  let highestHigh = -Infinity
  let highestHighIdx = 0

  candles.forEach((c, i) => {
    if (c.l < lowestLow) {
      lowestLow = c.l
      lowestLowIdx = i
    }
    if (c.h > highestHigh) {
      highestHigh = c.h
      highestHighIdx = i
    }
  })

  let maeTicks: number
  let mfeTicks: number
  let maeBarIdx: number
  let mfeBarIdx: number

  if (direction === 'long') {
    maeTicks = priceToTicks(entryPrice - lowestLow)
    mfeTicks = priceToTicks(highestHigh - entryPrice)
    maeBarIdx = lowestLowIdx
    mfeBarIdx = highestHighIdx
  } else {
    maeTicks = priceToTicks(highestHigh - entryPrice)
    mfeTicks = priceToTicks(entryPrice - lowestLow)
    maeBarIdx = highestHighIdx
    mfeBarIdx = lowestLowIdx
  }

  // Conservative edge-bar flag: if BOTH extremes come solely from the entry
  // (first) or exit (last) bar, we can't trust intra-bar ordering vs. the fill.
  const lastIdx = candles.length - 1
  const isEdge = (idx: number) => idx === 0 || idx === lastIdx
  const edgebar = isEdge(maeBarIdx) && isEdge(mfeBarIdx)

  return {
    mae_ticks: maeTicks,
    mfe_ticks: mfeTicks,
    excursion_source: edgebar ? 'polygon_1min_edgebar' : 'polygon_1min',
  }
}

/**
 * SPY-proxy excursion: rescale each SPY bar into the trade's own price space via
 * k = entryPrice / (SPY price at entry), then reuse computeExcursions. This maps
 * 1 SPY point to the local ES-points-per-SPY ratio at trade time, sidestepping
 * the drifting index/SPY basis as much as a proxy can.
 *
 * Approximation caveats: SPY carries ETF tracking error, has no overnight
 * session (trades fully outside RTH+extended return null → no_data), and the
 * entry reference is the minute-open, not the exact fill. Treat resulting ticks
 * as directional, not tick-exact.
 */
export function computeExcursionsViaProxy(
  direction: 'long' | 'short',
  entryPrice: number,
  proxyCandles: PolygonCandle[],
): ExcursionResult | null {
  if (proxyCandles.length === 0) return null
  const ref = proxyCandles[0].o
  if (!(ref > 0)) return null

  const k = entryPrice / ref
  const scaled = proxyCandles.map((c) => ({
    ...c,
    o: c.o * k,
    h: c.h * k,
    l: c.l * k,
    c: c.c * k,
  }))

  const result = computeExcursions(direction, entryPrice, scaled)
  if (!result) return null

  return {
    ...result,
    excursion_source:
      result.excursion_source === 'polygon_1min_edgebar' ? 'spy_proxy_edgebar' : 'spy_proxy',
  }
}

/**
 * Loss classification. Only losing trades (net P&L < 0) get a type;
 * winners and breakeven/scratch trades return null.
 */
export function classifyLoss(netPnl: number, mfeTicks: number): LossType | null {
  if (netPnl >= 0) return null
  return mfeTicks >= REVERSAL_LOSS_MFE_TICKS ? 'reversal_loss' : 'straight_loss'
}
