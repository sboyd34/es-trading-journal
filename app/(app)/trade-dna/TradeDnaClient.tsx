'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Trade } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, cn } from '@/lib/utils'
import { subDays, startOfWeek, startOfMonth, parseISO } from 'date-fns'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts'
import { Fingerprint } from 'lucide-react'

type DateRange = 'this-week' | 'this-month' | 'last-30' | 'all-time'

const DATE_RANGES: { id: DateRange; label: string }[] = [
  { id: 'this-week', label: 'This Week' },
  { id: 'this-month', label: 'This Month' },
  { id: 'last-30', label: 'Last 30 Days' },
  { id: 'all-time', label: 'All Time' },
]

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15]
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

const tooltipStyle = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#f3f4f6',
  },
}

function matchSetup(trade: Trade): string {
  const raw = `${trade.setup_tag ?? ''} ${trade.trade_setup ?? ''}`.toLowerCase().trim()
  if (!raw) return 'Untagged'
  if (raw.includes('orb')) return 'ORB Break'
  if (raw.includes('ttm') || raw.includes('squeeze')) return 'TTM Squeeze'
  if (raw.includes('avwap') || (raw.includes('vwap') && raw.includes('bounce'))) return 'AVWAP Bounce'
  if (raw.includes('fvg') || raw.includes('fair value')) return 'FVG Bounce'
  if (raw.includes('vah') || raw.includes('val ') || raw.includes('value area')) return 'VAH/VAL Bounce'
  if (raw.includes('divergence') || raw.includes('trendline')) return 'Divergence/TB'
  return 'Other'
}

function ctHour(entryTime: string): number | null {
  try {
    const date = new Date(entryTime)
    const ctStr = date.toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour12: false,
      hour: '2-digit',
    })
    return parseInt(ctStr, 10)
  } catch {
    return null
  }
}

function tradeDayOfWeek(dateStr: string): number {
  const d = parseISO(dateStr)
  const dow = d.getDay() // 0=Sun, 1=Mon...6=Sat
  return dow === 0 ? 7 : dow // 1=Mon...5=Fri
}

interface GroupStats {
  label: string
  count: number
  wins: number
  losses: number
  winRate: number
  totalPnL: number
  avgPnL: number
  avgWin: number
  avgLoss: number
}

function computeGroup(trades: Trade[], label: string): GroupStats {
  const wins = trades.filter(t => t.net_pnl > 0)
  const losses = trades.filter(t => t.net_pnl <= 0)
  const totalPnL = trades.reduce((sum, t) => sum + t.net_pnl, 0)
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.net_pnl, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? losses.reduce((sum, t) => sum + t.net_pnl, 0) / losses.length : 0
  return {
    label,
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    totalPnL,
    avgPnL: trades.length > 0 ? totalPnL / trades.length : 0,
    avgWin,
    avgLoss,
  }
}

function groupBy<K>(trades: Trade[], key: (t: Trade) => K | null): Map<K, Trade[]> {
  const map = new Map<K, Trade[]>()
  for (const t of trades) {
    const k = key(t)
    if (k === null) continue
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(t)
  }
  return map
}

export default function TradeDnaClient() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState<DateRange>('all-time')

  const supabase = createClient()

  const loadTrades = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_time', { ascending: true })
    setTrades((data as Trade[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadTrades()
  }, [loadTrades])

  const filtered = useMemo(() => {
    if (dateRange === 'all-time') return trades
    const now = new Date()
    const cutoff =
      dateRange === 'this-week' ? startOfWeek(now, { weekStartsOn: 1 }) :
      dateRange === 'this-month' ? startOfMonth(now) :
      subDays(now, 30)
    return trades.filter(t => parseISO(t.date) >= cutoff)
  }, [trades, dateRange])

  const dna = useMemo(() => {
    if (!filtered.length) return null

    // By setup
    const setupMap = groupBy(filtered, t => matchSetup(t))
    const bySetup: GroupStats[] = Array.from(setupMap.entries())
      .map(([label, ts]) => computeGroup(ts, label))
      .filter(s => s.count >= 2)
      .sort((a, b) => b.totalPnL - a.totalPnL)

    // By hour (CT)
    const hourMap = groupBy(filtered, t => {
      const h = ctHour(t.entry_time)
      return h !== null && h >= 8 && h <= 15 ? h : null
    })
    const byHour = HOURS
      .filter(h => hourMap.has(h))
      .map(h => computeGroup(hourMap.get(h)!, `${h}:00`))

    // By day of week
    const dayMap = groupBy(filtered, t => {
      const d = tradeDayOfWeek(t.date)
      return d >= 1 && d <= 5 ? d : null
    })
    const byDay = [1, 2, 3, 4, 5]
      .filter(d => dayMap.has(d))
      .map(d => computeGroup(dayMap.get(d)!, DAY_LABELS[d - 1]))

    // By mood
    const moodMap = groupBy(filtered, t => t.mood ?? 'unlogged')
    const byMood: GroupStats[] = Array.from(moodMap.entries())
      .map(([label, ts]) => computeGroup(ts, label))
      .filter(s => s.count >= 2)
      .sort((a, b) => b.winRate - a.winRate)

    // By grade
    const gradeMap = groupBy(filtered, t => t.grade ?? 'Ungraded')
    const byGrade: GroupStats[] = ['A', 'B', 'C', 'Ungraded']
      .filter(g => gradeMap.has(g as 'A' | 'B' | 'C' | 'Ungraded'))
      .map(g => computeGroup(gradeMap.get(g as 'A' | 'B' | 'C' | 'Ungraded')!, g))

    // Best combos: setup × mood with ≥ 3 trades
    const comboMap = new Map<string, Trade[]>()
    for (const t of filtered) {
      const s = matchSetup(t)
      if (s === 'Untagged' || s === 'Other') continue
      if (!t.mood) continue
      const key = `${s} + ${t.mood}`
      if (!comboMap.has(key)) comboMap.set(key, [])
      comboMap.get(key)!.push(t)
    }
    const bestCombos = Array.from(comboMap.entries())
      .filter(([, ts]) => ts.length >= 3)
      .map(([key, ts]) => computeGroup(ts, key))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 6)

    // Edge summary cards
    const bestSetup = bySetup.find(s => s.count >= 3) ?? null
    const bestHour = [...byHour].sort((a, b) => b.winRate - a.winRate).find(h => h.count >= 3) ?? null
    const bestDay = [...byDay].sort((a, b) => b.winRate - a.winRate).find(d => d.count >= 3) ?? null
    const bestMood = byMood.find(m => m.count >= 3) ?? null

    return { bySetup, byHour, byDay, byMood, byGrade, bestCombos, bestSetup, bestHour, bestDay, bestMood }
  }, [filtered])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading your trade history...
      </div>
    )
  }

  if (!trades.length) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No trades yet. Start logging to unlock your Trade DNA.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Fingerprint className="h-6 w-6 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trade DNA</h1>
            <p className="text-sm text-gray-500">Where your statistical edge actually lives</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {DATE_RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setDateRange(r.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                dateRange === r.id
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!dna ? (
        <div className="text-center py-16 text-gray-500 text-sm">Not enough data in this range.</div>
      ) : (
        <>
          {/* Edge Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: 'Best Setup',
                value: dna.bestSetup?.label ?? '—',
                sub: dna.bestSetup ? `${Math.round(dna.bestSetup.winRate * 100)}% win rate` : 'Need 3+ trades',
              },
              {
                label: 'Best Hour (CT)',
                value: dna.bestHour?.label ?? '—',
                sub: dna.bestHour ? `${Math.round(dna.bestHour.winRate * 100)}% win rate` : 'Need 3+ trades',
              },
              {
                label: 'Best Day',
                value: dna.bestDay?.label ?? '—',
                sub: dna.bestDay ? `${Math.round(dna.bestDay.winRate * 100)}% win rate` : 'Need 3+ trades',
              },
              {
                label: 'Best Mood',
                value: dna.bestMood?.label ?? '—',
                sub: dna.bestMood ? `${Math.round(dna.bestMood.winRate * 100)}% win rate` : 'Need 3+ trades',
              },
            ].map(card => (
              <div
                key={card.label}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4"
              >
                <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white truncate">{card.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Row 1: Setup Breakdown + Day of Week */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Setup Breakdown" sub={`${filtered.length} trades · sorted by total P&L`}>
              {dna.bySetup.length === 0 ? (
                <EmptyMsg text="Tag your trades with a setup to see breakdown." />
              ) : (
                <div className="space-y-4">
                  {dna.bySetup.map(s => <SetupRow key={s.label} s={s} />)}
                </div>
              )}
            </Panel>

            <Panel title="Day of Week" sub="Net P&L by trading day">
              {dna.byDay.length === 0 ? (
                <EmptyMsg />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dna.byDay} barSize={36} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={v => `$${v}`} axisLine={false} tickLine={false} width={52} />
                    <Tooltip {...tooltipStyle} formatter={(v: unknown) => [typeof v === 'number' ? formatCurrency(v) : String(v ?? ''), 'Net P&L']} />
                    <ReferenceLine y={0} stroke="#6b7280" />
                    <Bar dataKey="totalPnL" radius={[4, 4, 0, 0]}>
                      {dna.byDay.map(d => (
                        <Cell key={d.label} fill={d.totalPnL >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          {/* Row 2: Time of Day + Mood */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Time of Day" sub="Win rate by entry hour (CT) — 50% line = break-even">
              {dna.byHour.length === 0 ? (
                <EmptyMsg />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dna.byHour} barSize={28} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickFormatter={v => `${Math.round(v * 100)}%`}
                      domain={[0, 1]}
                      axisLine={false}
                      tickLine={false}
                      width={36}
                    />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v: unknown) => [
                        typeof v === 'number' ? `${Math.round(v * 100)}%` : String(v ?? ''),
                        'Win Rate',
                      ]}
                    />
                    <ReferenceLine y={0.5} stroke="#6b7280" strokeDasharray="4 4" />
                    <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                      {dna.byHour.map(h => (
                        <Cell key={h.label} fill={h.winRate >= 0.5 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>

            <Panel title="Mood vs. Outcome" sub="Win rate and avg P&L by emotional state">
              {dna.byMood.length === 0 ? (
                <EmptyMsg text="Log mood on your trades to unlock this panel." />
              ) : (
                <div className="space-y-3">
                  {dna.byMood.map(m => <MoodRow key={m.label} m={m} />)}
                </div>
              )}
            </Panel>
          </div>

          {/* Row 3: Grade Accuracy + Best Combos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Panel title="Grade Accuracy" sub="Did your self-assessment predict outcomes?">
              {dna.byGrade.length === 0 ? (
                <EmptyMsg text="Grade your trades (A/B/C) to unlock this panel." />
              ) : (
                <div className="space-y-4">
                  {dna.byGrade.map(g => <GradeRow key={g.label} g={g} />)}
                </div>
              )}
            </Panel>

            <Panel title="Best Combos" sub="Setup × Mood — min 3 trades to qualify">
              {dna.bestCombos.length === 0 ? (
                <EmptyMsg text="Log setup tags + mood on 3+ trades with the same combo to see patterns." />
              ) : (
                <div className="space-y-2.5">
                  {dna.bestCombos.map((c, i) => <ComboRow key={c.label} c={c} rank={i + 1} />)}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function Panel({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
      </div>
      {children}
    </div>
  )
}

function EmptyMsg({ text = 'Not enough data yet.' }: { text?: string }) {
  return <p className="text-sm text-gray-400 py-4">{text}</p>
}

function WinRateBar({ winRate, count }: { winRate: number; count: number }) {
  const pct = Math.round(winRate * 100)
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 50 ? 'bg-emerald-500' : 'bg-red-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-xs font-semibold w-8 text-right', pct >= 50 ? 'text-emerald-500' : 'text-red-500')}>
        {pct}%
      </span>
      <span className="text-xs text-gray-400 w-8 text-right">{count}T</span>
    </div>
  )
}

function SetupRow({ s }: { s: GroupStats }) {
  return (
    <div>
      <div className="flex justify-between items-baseline">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{s.label}</span>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>avg {formatCurrency(s.avgWin)} / {formatCurrency(s.avgLoss)}</span>
          <span className={cn('text-sm font-semibold', s.totalPnL >= 0 ? 'text-emerald-500' : 'text-red-500')}>
            {formatCurrency(s.totalPnL)}
          </span>
        </div>
      </div>
      <WinRateBar winRate={s.winRate} count={s.count} />
    </div>
  )
}

function MoodRow({ m }: { m: GroupStats }) {
  const pct = Math.round(m.winRate * 100)
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600 dark:text-gray-400 w-28 capitalize flex-shrink-0">{m.label}</span>
      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', pct >= 50 ? 'bg-emerald-500' : 'bg-red-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn('text-xs font-semibold w-8 text-right flex-shrink-0', pct >= 50 ? 'text-emerald-500' : 'text-red-500')}>
        {pct}%
      </span>
      <span className="text-xs text-gray-400 w-14 text-right flex-shrink-0">{formatCurrency(m.avgPnL)}</span>
    </div>
  )
}

const GRADE_COLOR: Record<string, string> = {
  A: 'text-emerald-500',
  B: 'text-blue-500',
  C: 'text-amber-500',
  Ungraded: 'text-gray-400',
}

function GradeRow({ g }: { g: GroupStats }) {
  const pct = Math.round(g.winRate * 100)
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold w-16', GRADE_COLOR[g.label])}>Grade {g.label}</span>
          <span className="text-xs text-gray-400">{g.count} trades</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-gray-400">avg {formatCurrency(g.avgPnL)}</span>
          <span className={cn('font-semibold', pct >= 50 ? 'text-emerald-500' : 'text-red-500')}>{pct}%</span>
        </div>
      </div>
      <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', pct >= 50 ? 'bg-emerald-500' : 'bg-red-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function ComboRow({ c, rank }: { c: GroupStats; rank: number }) {
  const pct = Math.round(c.winRate * 100)
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs font-mono text-gray-400 w-5 flex-shrink-0">{rank}.</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{c.label}</p>
        <p className="text-xs text-gray-400">{c.count} trades · {formatCurrency(c.totalPnL)}</p>
      </div>
      <span className={cn('text-sm font-bold flex-shrink-0', pct >= 60 ? 'text-emerald-500' : pct >= 50 ? 'text-blue-400' : 'text-red-400')}>
        {pct}%
      </span>
    </div>
  )
}
