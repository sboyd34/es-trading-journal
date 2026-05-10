'use client'

import { useMemo, useState } from 'react'
import { Trade } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'
import {
  eachDayOfInterval,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  format,
  isSameMonth,
} from 'date-fns'

interface PnLCalendarProps {
  trades: Trade[]
}

function getDayColor(pnl: number | undefined): string {
  if (pnl === undefined) return ''
  if (pnl > 500) return 'bg-emerald-500'
  if (pnl > 0) return 'bg-emerald-800/70'
  if (pnl < -500) return 'bg-red-500'
  if (pnl < 0) return 'bg-red-800/70'
  return 'bg-gray-600'
}

export default function PnLCalendar({ trades }: PnLCalendarProps) {
  const [tooltip, setTooltip] = useState<{ date: string; pnl: number; x: number; y: number } | null>(null)

  const { months, dailyPnL } = useMemo(() => {
    // Build daily P&L map
    const pnlMap = new Map<string, number>()
    for (const trade of trades) {
      const d = trade.date
      pnlMap.set(d, (pnlMap.get(d) || 0) + trade.net_pnl)
    }

    // Last 3 months
    const now = new Date()
    const monthsData = []
    for (let i = 2; i >= 0; i--) {
      const month = subMonths(now, i)
      const start = startOfMonth(month)
      const end = endOfMonth(month)
      const calStart = startOfWeek(start, { weekStartsOn: 0 })
      const calEnd = endOfWeek(end, { weekStartsOn: 0 })
      const days = eachDayOfInterval({ start: calStart, end: calEnd })
      monthsData.push({
        label: format(month, 'MMMM yyyy'),
        days,
        monthDate: month,
      })
    }

    return { months: monthsData, dailyPnL: pnlMap }
  }, [trades])

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">P&L Calendar — Last 3 Months</h3>

      <div className="space-y-6">
        {months.map((month) => (
          <div key={month.label}>
            <p className="text-xs font-medium text-gray-400 mb-2">{month.label}</p>
            {/* Day of week headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                <div key={d} className="text-center text-[10px] text-gray-600 font-medium">
                  {d}
                </div>
              ))}
            </div>
            {/* Days grid */}
            <div className="grid grid-cols-7 gap-1">
              {month.days.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd')
                const pnl = dailyPnL.get(dateStr)
                const inMonth = isSameMonth(day, month.monthDate)
                const dayColor = inMonth && pnl !== undefined ? getDayColor(pnl) : ''

                return (
                  <div
                    key={dateStr}
                    className={cn(
                      'aspect-square rounded-sm flex items-center justify-center text-[9px] cursor-default relative',
                      inMonth ? 'bg-gray-700/30' : 'bg-transparent',
                      dayColor && inMonth && pnl !== undefined ? dayColor : ''
                    )}
                    onMouseEnter={(e) => {
                      if (inMonth && pnl !== undefined) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTooltip({
                          date: format(day, 'MMM d, yyyy'),
                          pnl,
                          x: rect.left,
                          y: rect.top,
                        })
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    <span className={cn(
                      'font-medium',
                      inMonth ? 'text-gray-400' : 'text-transparent'
                    )}>
                      {format(day, 'd')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-4 flex-wrap">
        <span className="text-xs text-gray-500">P&L:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-emerald-500" />
          <span className="text-xs text-gray-500">&gt;$500</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-emerald-800/70" />
          <span className="text-xs text-gray-500">$0-500</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-red-800/70" />
          <span className="text-xs text-gray-500">$0 to -500</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-xs text-gray-500">&lt;-$500</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-xl pointer-events-none"
          style={{ left: tooltip.x + 10, top: tooltip.y - 40 }}
        >
          <p className="text-xs text-gray-400">{tooltip.date}</p>
          <p className={`text-sm font-bold ${tooltip.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatCurrency(tooltip.pnl)}
          </p>
        </div>
      )}
    </div>
  )
}
