// Pure technical-indicator math. Computed client-side from OHLCV data
// so we don't burn polygon.io calls just for derived values.

export interface OHLCV {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

// Volume-weighted average price across all bars in the series. For a
// series that starts at the first bar of a session, this matches the
// canonical session VWAP traders watch.
export function computeVWAP(candles: OHLCV[]): (number | null)[] {
  let cumPV = 0
  let cumV  = 0
  return candles.map((c) => {
    const typical = (c.h + c.l + c.c) / 3
    cumPV += typical * c.v
    cumV  += c.v
    return cumV > 0 ? cumPV / cumV : null
  })
}

// Standard EMA over closing prices. Result is aligned to `candles` and
// returns null for any bar before the first valid EMA value (i.e. the
// first `period - 1` bars).
export function computeEMA(candles: OHLCV[], period: number): (number | null)[] {
  if (period <= 0 || candles.length === 0) return candles.map(() => null)
  const k = 2 / (period + 1)
  const out: (number | null)[] = []

  // Seed with a simple average over the first `period` closes.
  let seedSum = 0
  let ema: number | null = null

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].c
    if (i < period - 1) {
      seedSum += close
      out.push(null)
      continue
    }
    if (i === period - 1) {
      seedSum += close
      ema = seedSum / period
      out.push(ema)
      continue
    }
    ema = (close - (ema as number)) * k + (ema as number)
    out.push(ema)
  }
  return out
}
