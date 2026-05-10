'use client'

import { useMemo } from 'react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { Trade } from '@/types'
import { formatCurrency, getMoodEmoji } from '@/lib/utils'

interface EmotionBreakdownProps {
  trades: Trade[]
}

const MOOD_COLORS: Record<string, string> = {
  calm: '#2dd4bf',
  confident: '#34d399',
  anxious: '#fb923c',
  FOMO: '#f87171',
  revenge: '#b91c1c',
  hesitant: '#facc15',
  bored: '#9ca3af',
  overconfident: '#a855f7',
}

const MOODS = ['calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident']

export default function EmotionBreakdown({ trades }: EmotionBreakdownProps) {
  const { pieData, barData } = useMemo(() => {
    const moodCounts = new Map<string, number>()
    const moodPnL = new Map<string, number[]>()

    for (const trade of trades) {
      if (!trade.mood) continue
      moodCounts.set(trade.mood, (moodCounts.get(trade.mood) || 0) + 1)
      if (!moodPnL.has(trade.mood)) moodPnL.set(trade.mood, [])
      moodPnL.get(trade.mood)!.push(trade.net_pnl)
    }

    const pie = MOODS
      .filter((m) => moodCounts.has(m))
      .map((m) => ({
        name: m,
        value: moodCounts.get(m) || 0,
        label: `${getMoodEmoji(m)} ${m}`,
        color: MOOD_COLORS[m],
      }))

    const bar = MOODS
      .filter((m) => moodPnL.has(m))
      .map((m) => {
        const pnls = moodPnL.get(m)!
        const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length
        return {
          name: getMoodEmoji(m),
          fullName: m,
          avg: Math.round(avg),
          color: MOOD_COLORS[m],
        }
      })

    return { pieData: pie, barData: bar }
  }, [trades])

  if (!trades.length || !pieData.length) {
    return (
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 flex items-center justify-center h-52">
        <p className="text-gray-500 text-sm">No mood data yet</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Emotion Breakdown</h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Pie chart */}
        <div>
          <p className="text-xs text-gray-500 mb-2">Trade Count by Mood</p>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={65}
                dataKey="value"
                paddingAngle={2}
              >
                {pieData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#f3f4f6',
                }}
                formatter={(value) => [value, String(value)]}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
            {pieData.map((d) => (
              <div key={d.name} className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="text-[10px] text-gray-400">{d.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bar chart */}
        <div>
          <p className="text-xs text-gray-500 mb-2">Avg P&L by Mood</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={barData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 14 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v}`}
              />
              <ReferenceLine y={0} stroke="#4b5563" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#f3f4f6',
                }}
                formatter={(value, _name, item) => [
                  formatCurrency(Number(value)),
                  (item as { payload: { fullName: string } }).payload.fullName,
                ]}
              />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                {barData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
