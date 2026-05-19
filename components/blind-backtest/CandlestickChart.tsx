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

  // Effect A — initialize chart once per (candles reference, indicator config, height, overlays)
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
      if (handle && visibleCount !== undefined && visibleCount < candles.length) {
        const sliced = candles.slice(0, Math.max(1, visibleCount))
        handle.series.setData(sliced.map(toLightweightCandle))
      }
    }

    setup()

    return () => {
      cleanedUp = true
      chartRef.current?.observer.disconnect()
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

  let disposed = false
  const observer = new ResizeObserver(() => {
    if (disposed) return
    try {
      chart.applyOptions({ width: el.clientWidth })
    } catch {
      // chart was removed between disconnect() being called and this callback firing
      disposed = true
    }
  })
  observer.observe(el)

  return { chart, series, observer }
}
