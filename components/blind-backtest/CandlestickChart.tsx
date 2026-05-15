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
  ema50: boolean
}

interface Props {
  candles: Candle[]
  entryPrice?: number
  stopPrice?: number
  targetPrice?: number
  exitPrice?: number
  cutoffTimestamp?: number  // Unix seconds — draws a vertical marker at this candle
  entryTimestamp?: number   // Unix seconds — marker showing entry bar
  exitTimestamp?: number    // Unix seconds — marker showing exit bar
  direction?: 'long' | 'short'
  indicators?: IndicatorPrefs
  height?: number
}

export default function CandlestickChart({
  candles,
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

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return

    let cleanedUp = false

    async function init() {
      const {
        createChart,
        ColorType,
        LineStyle,
        CrosshairMode,
      } = await import('lightweight-charts')

      if (cleanedUp || !containerRef.current) return

      const chart = createChart(containerRef.current, {
        width:  containerRef.current.clientWidth,
        height,
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
        rightPriceScale: {
          borderColor: '#374151',
          textColor: '#9ca3af',
        },
        timeScale: {
          borderColor: '#374151',
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (ts: number) => {
            return new Date(ts * 1000).toLocaleTimeString('en-US', {
              timeZone: 'America/Chicago',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })
          },
        },
        localization: {
          timeFormatter: (ts: number) => {
            return new Date(ts * 1000).toLocaleTimeString('en-US', {
              timeZone: 'America/Chicago',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })
          },
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      })

      const series = chart.addCandlestickSeries({
        upColor:          '#10b981',
        downColor:        '#ef4444',
        borderUpColor:    '#10b981',
        borderDownColor:  '#ef4444',
        wickUpColor:      '#10b981',
        wickDownColor:    '#ef4444',
      })

      const chartData = candles.map((c) => ({
        time:  c.t as unknown as import('lightweight-charts').Time,
        open:  c.o,
        high:  c.h,
        low:   c.l,
        close: c.c,
      }))

      series.setData(chartData)

      // Indicator overlays — line series for VWAP / EMAs
      if (indicators) {
        type LineCfg = { key: keyof IndicatorPrefs; color: string; title: string; values: (number | null)[] }
        const overlays: LineCfg[] = []
        if (indicators.vwap)  overlays.push({ key: 'vwap',  color: '#facc15', title: 'VWAP',   values: computeVWAP(candles) })
        if (indicators.ema9)  overlays.push({ key: 'ema9',  color: '#22d3ee', title: 'EMA 9',  values: computeEMA(candles, 9) })
        if (indicators.ema20) overlays.push({ key: 'ema20', color: '#60a5fa', title: 'EMA 20', values: computeEMA(candles, 20) })
        if (indicators.ema50) overlays.push({ key: 'ema50', color: '#fb923c', title: 'EMA 50', values: computeEMA(candles, 50) })

        for (const o of overlays) {
          const line = chart.addLineSeries({
            color: o.color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            title: o.title,
          })
          const data = candles
            .map((c, i) => ({ time: c.t as unknown as import('lightweight-charts').Time, value: o.values[i] }))
            .filter((d): d is { time: import('lightweight-charts').Time; value: number } => d.value != null)
          line.setData(data)
        }
      }

      // Price lines for reveal mode
      if (entryPrice !== undefined) {
        series.createPriceLine({
          price: entryPrice,
          color: '#3b82f6',
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: direction === 'long' ? '▲ Entry' : '▼ Entry',
        })
      }
      if (stopPrice !== undefined) {
        series.createPriceLine({
          price: stopPrice,
          color: '#ef4444',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Stop',
        })
      }
      if (targetPrice !== undefined) {
        series.createPriceLine({
          price: targetPrice,
          color: '#10b981',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Target',
        })
      }
      if (exitPrice !== undefined) {
        series.createPriceLine({
          price: exitPrice,
          color: '#a78bfa',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'Exit',
        })
      }

      // Vertical markers — supports either the legacy `cutoffTimestamp`
      // (single arrow above the bar) or `entryTimestamp`/`exitTimestamp`
      // pairs for showing a real trade's lifetime.
      const markers: {
        time: import('lightweight-charts').Time
        position: 'aboveBar' | 'belowBar'
        color: string
        shape: 'arrowDown' | 'arrowUp' | 'circle' | 'square'
        text: string
      }[] = []
      if (cutoffTimestamp !== undefined) {
        markers.push({
          time: cutoffTimestamp as unknown as import('lightweight-charts').Time,
          position: 'aboveBar', color: '#f59e0b', shape: 'arrowDown', text: 'Entry window',
        })
      }
      if (entryTimestamp !== undefined) {
        markers.push({
          time: entryTimestamp as unknown as import('lightweight-charts').Time,
          position: direction === 'long' ? 'belowBar' : 'aboveBar',
          color: '#3b82f6',
          shape: direction === 'long' ? 'arrowUp' : 'arrowDown',
          text: 'Entry',
        })
      }
      if (exitTimestamp !== undefined) {
        markers.push({
          time: exitTimestamp as unknown as import('lightweight-charts').Time,
          position: 'aboveBar',
          color: '#a78bfa',
          shape: 'circle',
          text: 'Exit',
        })
      }
      if (markers.length > 0) {
        markers.sort((a, b) => (a.time as unknown as number) - (b.time as unknown as number))
        series.setMarkers(markers)
      }

      chart.timeScale().fitContent()

      // Responsive resize
      const observer = new ResizeObserver(() => {
        if (containerRef.current) {
          chart.applyOptions({ width: containerRef.current.clientWidth })
        }
      })
      observer.observe(containerRef.current)

      return () => {
        cleanedUp = true
        observer.disconnect()
        chart.remove()
      }
    }

    let cleanup: (() => void) | undefined
    init().then((fn) => { cleanup = fn })

    return () => {
      cleanedUp = true
      cleanup?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, entryPrice, stopPrice, targetPrice, exitPrice, cutoffTimestamp, entryTimestamp, exitTimestamp, height,
      indicators?.vwap, indicators?.ema9, indicators?.ema20, indicators?.ema50])

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full rounded-lg overflow-hidden bg-gray-900/40"
    />
  )
}
