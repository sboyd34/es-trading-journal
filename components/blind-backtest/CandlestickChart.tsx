'use client'

import { useEffect, useRef } from 'react'

export interface Candle {
  t: number  // Unix seconds (UTC)
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface Props {
  candles: Candle[]
  entryPrice?: number
  stopPrice?: number
  targetPrice?: number
  cutoffTimestamp?: number  // Unix seconds — draws a vertical marker at this candle
  direction?: 'long' | 'short'
  height?: number
}

export default function CandlestickChart({
  candles,
  entryPrice,
  stopPrice,
  targetPrice,
  cutoffTimestamp,
  direction,
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

      // Vertical marker at cutoff candle
      if (cutoffTimestamp !== undefined) {
        series.setMarkers([{
          time: cutoffTimestamp as unknown as import('lightweight-charts').Time,
          position: 'aboveBar',
          color: '#f59e0b',
          shape: 'arrowDown',
          text: 'Entry window',
        }])
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
  }, [candles, entryPrice, stopPrice, targetPrice, cutoffTimestamp, height])

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full rounded-lg overflow-hidden bg-gray-900/40"
    />
  )
}
