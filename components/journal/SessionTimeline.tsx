'use client'

import { useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Trade } from '@/types'
import { formatCurrency } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  trades: Trade[]
  onAnnotate: (trade: Trade) => void
  defaultDate?: string
}

function toCtMins(iso: string): number {
  const d = new Date(iso)
  const ctStr = d.toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const [h, m] = ctStr.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function ctLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SessionTimeline({ trades, onAnnotate, defaultDate }: Props) {
  const tradingDates = useMemo(() => {
    const dates = Array.from(new Set(trades.map((t) => t.date)))
    return dates.sort((a, b) => a.localeCompare(b))
  }, [trades])

  const [selectedDate, setSelectedDate] = useState<string>(
    defaultDate ?? tradingDates[tradingDates.length - 1] ?? ''
  )

  const currentIdx = tradingDates.indexOf(selectedDate)

  const dayData = useMemo(() => {
    const day = trades
      .filter((t) => t.date === selectedDate)
      .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())

    let cumulative = 0
    return day.map((t) => {
      cumulative += t.net_pnl
      return { ...t, cumulative: Math.round(cumulative * 100) / 100 }
    })
  }, [trades, selectedDate])

  if (trades.length === 0) return null
  if (tradingDates.length === 0) return null

  const goPrev = () => {
    if (currentIdx > 0) setSelectedDate(tradingDates[currentIdx - 1])
  }
  const goNext = () => {
    if (currentIdx < tradingDates.length - 1) setSelectedDate(tradingDates[currentIdx + 1])
  }
  const goToday = () => {
    const today = new Date().toISOString().slice(0, 10)
    if (tradingDates.includes(today)) setSelectedDate(today)
  }
  const today = new Date().toISOString().slice(0, 10)
  const todayHasTrades = tradingDates.includes(today)

  const BUFFER_MINS = 5
  const MIN_BAR_PCT = 2

  const sessionStartMins =
    dayData.length > 0
      ? Math.max(0, toCtMins(dayData[0].entry_time) - BUFFER_MINS)
      : 0
  const sessionEndMins =
    dayData.length > 0
      ? toCtMins(dayData[dayData.length - 1].exit_time ?? dayData[dayData.length - 1].entry_time) + BUFFER_MINS
      : sessionStartMins + 60
  const sessionDurationMins = Math.max(sessionEndMins - sessionStartMins, 1)

  function barLeft(entryMins: number): number {
    return ((entryMins - sessionStartMins) / sessionDurationMins) * 100
  }
  function barWidth(entryMins: number, exitMins: number): number {
    return Math.max(((exitMins - entryMins) / sessionDurationMins) * 100, MIN_BAR_PCT)
  }

  const chartPoints = dayData.map((t) => ({
    time: ctLabel(t.entry_time),
    cumulative: t.cumulative,
    net_pnl: t.net_pnl,
  }))

  const allCumulatives = chartPoints.map((p) => p.cumulative)
  const minY = Math.min(0, ...allCumulatives)
  const maxY = Math.max(0, ...allCumulatives)
  const finalCumulative = chartPoints[chartPoints.length - 1]?.cumulative ?? 0

  return (
    <div className="space-y-4">
      {/* Date Navigator */}
      <div className="flex items-center gap-3">
        <button
          onClick={goPrev}
          disabled={currentIdx <= 0}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-white min-w-[120px] text-center">
          {selectedDate ? format(parseISO(selectedDate), 'MMM d, yyyy') : '—'}
        </span>
        <button
          onClick={goNext}
          disabled={currentIdx >= tradingDates.length - 1}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={goToday}
          disabled={!todayHasTrades || selectedDate === today}
          className="ml-1 px-3 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          Today
        </button>
      </div>

      {dayData.length === 0 ? (
        <div className="text-sm text-gray-500 py-6 text-center">No trades on this date.</div>
      ) : (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-4">
          {/* P&L Curve */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">Running P&L</p>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartPoints} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="tlGreenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tlRedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `$${v}`}
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  domain={[minY - 10, maxY + 10]}
                  width={55}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#9ca3af', fontSize: 11 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => {
                    const n = typeof value === 'number' ? value : 0
                    if (name === 'cumulative') return [formatCurrency(n), 'Running P&L']
                    return [formatCurrency(n), 'Trade P&L']
                  }}
                />
                <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="4 4" />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke={finalCumulative >= 0 ? '#34d399' : '#f87171'}
                  strokeWidth={2}
                  fill={finalCumulative >= 0 ? 'url(#tlGreenGrad)' : 'url(#tlRedGrad)'}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  dot={(props: any) => {
                    const { cx, cy, payload } = props as { cx: number; cy: number; payload: { net_pnl: number } }
                    const color = payload.net_pnl > 0 ? '#34d399' : '#f87171'
                    return (
                      <circle
                        key={`dot-${cx}-${cy}`}
                        cx={cx}
                        cy={cy}
                        r={5}
                        fill={color}
                        stroke="#111827"
                        strokeWidth={1.5}
                      />
                    )
                  }}
                  activeDot={{ r: 5, stroke: '#111827', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Trade Track */}
          <div>
            <p className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wider">Trade Track</p>
            <div className="relative h-12 w-full">
              {dayData.map((trade, i) => {
                const entryMins = toCtMins(trade.entry_time)
                const exitMins = trade.exit_time ? toCtMins(trade.exit_time) : entryMins + 1
                const left = barLeft(entryMins)
                const width = barWidth(entryMins, exitMins)
                const isWinner = trade.net_pnl > 0
                const isLoser = trade.net_pnl < 0

                const barBg = isWinner
                  ? 'bg-emerald-500/20 border-emerald-500/40 hover:bg-emerald-500/35'
                  : isLoser
                  ? 'bg-red-500/20 border-red-500/40 hover:bg-red-500/35'
                  : 'bg-gray-700/40 border-gray-600/40 hover:bg-gray-700/60'

                const tooltipText = [
                  `#${i + 1}`,
                  trade.setup_tag ?? 'untagged',
                  trade.grade ?? '?',
                  formatCurrency(trade.net_pnl),
                  `${ctLabel(trade.entry_time)} → ${trade.exit_time ? ctLabel(trade.exit_time) : '?'}`,
                ].join(' · ')

                return (
                  <button
                    key={trade.id}
                    onClick={() => onAnnotate(trade)}
                    title={tooltipText}
                    className={`absolute top-1 bottom-1 rounded border cursor-pointer transition ${barBg}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    <span className="px-1 text-[10px] text-white/70 truncate block overflow-hidden whitespace-nowrap leading-10">
                      {width > 8
                        ? `${trade.setup_tag ?? ''} · ${trade.grade ?? '?'} · ${formatCurrency(trade.net_pnl)}`
                        : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Day summary footer */}
          <div className="flex items-center gap-4 pt-1 border-t border-gray-700/50">
            <span className="text-xs text-gray-500">
              {dayData.length} trade{dayData.length !== 1 ? 's' : ''}
            </span>
            <span className="text-xs text-gray-500">
              {dayData.filter((t) => t.net_pnl > 0).length}W /{' '}
              {dayData.filter((t) => t.net_pnl <= 0).length}L
            </span>
            <span className={`text-xs font-semibold ${finalCumulative >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              Net {formatCurrency(finalCumulative)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
