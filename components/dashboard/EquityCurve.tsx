'use client'

import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Trade } from '@/types'
import { formatCurrency, getPnLColor } from '@/lib/utils'
import { format } from 'date-fns'

interface EquityCurveProps {
  trades: Trade[]
}

interface DataPoint {
  date: string
  cumulative: number
  tradeIndex: number
}

export default function EquityCurve({ trades }: EquityCurveProps) {
  const data = useMemo<DataPoint[]>(() => {
    if (!trades.length) return []

    const sorted = [...trades].sort((a, b) => {
      const da = new Date(a.entry_time || a.date).getTime()
      const db = new Date(b.entry_time || b.date).getTime()
      return da - db
    })

    let cumulative = 0
    return sorted.map((trade, i) => {
      cumulative += trade.net_pnl
      return {
        date: format(new Date(trade.entry_time || trade.date), 'MM/dd'),
        cumulative: Math.round(cumulative * 100) / 100,
        tradeIndex: i + 1,
      }
    })
  }, [trades])

  const totalPnL = data.length ? data[data.length - 1].cumulative : 0
  const isPositive = totalPnL >= 0
  const gradientColor = isPositive ? '#34d399' : '#f87171'
  const gradientId = isPositive ? 'emeraldGradient' : 'redGradient'

  if (!data.length) {
    return (
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 flex items-center justify-center h-64">
        <p className="text-gray-500 text-sm">No trades yet — equity curve will appear here</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">Equity Curve — All Time</h3>
          <p className="text-xs text-gray-500 mt-0.5">{data.length} trades</p>
        </div>
        <div className={`text-xl font-bold ${getPnLColor(totalPnL)}`}>
          {formatCurrency(totalPnL)}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="emeraldGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#34d399" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="redGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f87171" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1f2937',
              border: '1px solid #374151',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#f3f4f6',
            }}
            formatter={(value) => [formatCurrency(Number(value)), 'Cumulative P&L']}
            labelFormatter={(label) => `Trade: ${label}`}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke={gradientColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, fill: gradientColor, stroke: '#111827', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
