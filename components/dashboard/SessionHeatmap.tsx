'use client'

import { useMemo, useState } from 'react'
import { Trade } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'
import { parseISO, getDay, getHours } from 'date-fns'

interface SessionHeatmapProps {
  trades: Trade[]
}

const HOURS = Array.from({ length: 11 }, (_, i) => i + 6) // 6am - 4pm CT
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

function getCellColor(pnl: number | null): string {
  if (pnl === null) return 'bg-gray-800/30'
  if (pnl > 300) return 'bg-emerald-500'
  if (pnl > 150) return 'bg-emerald-600/80'
  if (pnl > 0) return 'bg-emerald-700/60'
  if (pnl < -300) return 'bg-red-500'
  if (pnl < -150) return 'bg-red-600/80'
  if (pnl < 0) return 'bg-red-700/60'
  return 'bg-gray-600/40'
}

export default function SessionHeatmap({ trades }: SessionHeatmapProps) {
  const [tooltip, setTooltip] = useState<{ day: string; hour: number; pnl: number; count: number; x: number; y: number } | null>(null)

  const heatmapData = useMemo(() => {
    // day 1-5 (Mon-Fri), hour 6-16
    const map = new Map<string, { total: number; count: number }>()

    for (const trade of trades) {
      const dt = parseISO(trade.entry_time || trade.date)
      const dayOfWeek = getDay(dt) // 0=Sun, 1=Mon ... 5=Fri, 6=Sat
      if (dayOfWeek < 1 || dayOfWeek > 5) continue
      const hour = getHours(dt)
      if (hour < 6 || hour > 16) continue

      const key = `${dayOfWeek}_${hour}`
      const existing = map.get(key) || { total: 0, count: 0 }
      map.set(key, { total: existing.total + trade.net_pnl, count: existing.count + 1 })
    }

    return map
  }, [trades])

  const getCell = (dayIndex: number, hour: number) => {
    // dayIndex: 0=Mon(1), 1=Tue(2), ... 4=Fri(5)
    const key = `${dayIndex + 1}_${hour}`
    const data = heatmapData.get(key)
    if (!data) return null
    return { avg: data.total / data.count, count: data.count }
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Session Heatmap (CT)</h3>

      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* Hour headers */}
          <div className="flex">
            <div className="w-10" />
            {HOURS.map((h) => (
              <div key={h} className="w-10 text-center text-[10px] text-gray-500 font-medium">
                {h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
              </div>
            ))}
          </div>

          {/* Rows: Mon-Fri */}
          {DAYS.map((day, dayIndex) => (
            <div key={day} className="flex items-center mt-1">
              <div className="w-10 text-[10px] text-gray-500 font-medium">{day}</div>
              {HOURS.map((hour) => {
                const cell = getCell(dayIndex, hour)
                const pnl = cell ? cell.avg : null
                return (
                  <div
                    key={hour}
                    className={cn(
                      'w-10 h-8 rounded-sm mx-0.5 cursor-default transition-opacity hover:opacity-80',
                      getCellColor(pnl)
                    )}
                    onMouseEnter={(e) => {
                      if (cell) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTooltip({
                          day,
                          hour,
                          pnl: cell.avg,
                          count: cell.count,
                          x: rect.left,
                          y: rect.top,
                        })
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span className="text-[10px] text-gray-500">Avg P&L:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-emerald-500" />
          <span className="text-[10px] text-gray-500">&gt;$300</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-emerald-700/60" />
          <span className="text-[10px] text-gray-500">$0-300</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-red-700/60" />
          <span className="text-[10px] text-gray-500">$0 to -300</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-[10px] text-gray-500">&lt;-$300</span>
        </div>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y - 60 }}
        >
          <p className="text-xs text-gray-400">{tooltip.day} {tooltip.hour}:00</p>
          <p className={`text-sm font-bold ${tooltip.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            Avg: {formatCurrency(tooltip.pnl)}
          </p>
          <p className="text-xs text-gray-500">{tooltip.count} trade{tooltip.count > 1 ? 's' : ''}</p>
        </div>
      )}
    </div>
  )
}
