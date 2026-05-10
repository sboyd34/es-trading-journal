'use client'

import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { Trade } from '@/types'
import { formatCurrency, getPnLColor } from '@/lib/utils'
import { startOfWeek, endOfWeek, isWithinInterval, format, parseISO } from 'date-fns'

interface WeekEquityCurveProps {
  trades: Trade[]
}

export default function WeekEquityCurve({ trades }: WeekEquityCurveProps) {
  const { data, weekPnL } = useMemo(() => {
    const now = new Date()
    const weekStart = startOfWeek(now, { weekStartsOn: 1 })
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 })

    const weekTrades = trades
      .filter((t) => {
        const d = parseISO(t.entry_time || t.date)
        return isWithinInterval(d, { start: weekStart, end: weekEnd })
      })
      .sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())

    let cumulative = 0
    const points = weekTrades.map((trade, i) => {
      cumulative += trade.net_pnl
      return {
        label: `${format(parseISO(trade.entry_time), 'EEE HH:mm')}`,
        cumulative: Math.round(cumulative * 100) / 100,
        index: i + 1,
      }
    })

    return { data: points, weekPnL: cumulative }
  }, [trades])

  const lineColor = weekPnL >= 0 ? '#34d399' : '#f87171'

  if (!data.length) {
    return (
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 flex items-center justify-center h-48">
        <p className="text-gray-500 text-sm">No trades this week</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">This Week</h3>
          <p className="text-xs text-gray-500 mt-0.5">{data.length} trades</p>
        </div>
        <div className={`text-lg font-bold ${getPnLColor(weekPnL)}`}>
          {formatCurrency(weekPnL)}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="4 4" />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#f3f4f6',
            }}
            formatter={(value) => [formatCurrency(Number(value)), 'Week P&L']}
          />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke={lineColor}
            strokeWidth={2}
            dot={{ r: 3, fill: lineColor, stroke: '#111827', strokeWidth: 1 }}
            activeDot={{ r: 5, fill: lineColor }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
