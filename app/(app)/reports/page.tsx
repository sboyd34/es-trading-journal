'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Trade } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, cn } from '@/lib/utils'
import { format, parseISO, getHours } from 'date-fns'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
  ReferenceLine,
  Legend,
} from 'recharts'

type Tab = 'overview' | 'hourly' | 'rmultiple' | 'maemfe' | 'drawdown' | 'direction' | 'emotion'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'hourly', label: 'Hourly P&L' },
  { id: 'rmultiple', label: 'R-Multiple' },
  { id: 'maemfe', label: 'MAE/MFE' },
  { id: 'drawdown', label: 'Drawdown' },
  { id: 'direction', label: 'Direction' },
  { id: 'emotion', label: 'Emotion' },
]

const tooltipStyle = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#f3f4f6',
  },
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-60 text-gray-500 text-sm">{message}</div>
  )
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)

  const supabase = createClient()

  const loadTrades = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
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

  // Hourly P&L data
  const hourlyData = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const t of trades) {
      const h = getHours(parseISO(t.entry_time))
      if (!map.has(h)) map.set(h, [])
      map.get(h)!.push(t.net_pnl)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, pnls]) => ({
        label: hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`,
        avg: pnls.reduce((a, b) => a + b, 0) / pnls.length,
        count: pnls.length,
      }))
  }, [trades])

  // R-Multiple distribution
  const rMultipleData = useMemo(() => {
    const tradesWithR = trades.filter((t) => t.stop_loss !== null && t.entry_price !== null)
    const rValues = tradesWithR.map((t) => {
      const riskPts = Math.abs(t.entry_price - t.stop_loss!)
      const pnlPts = (t.exit_price - t.entry_price) * (t.direction === 'long' ? 1 : -1)
      return riskPts > 0 ? pnlPts / riskPts : 0
    })

    // Bin into -4 to +4 range
    const bins = new Map<string, number>()
    const binEdges = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
    for (const edge of binEdges) bins.set(`${edge}R`, 0)

    for (const r of rValues) {
      const rounded = Math.round(Math.max(-4, Math.min(4, r)))
      const key = `${rounded}R`
      bins.set(key, (bins.get(key) || 0) + 1)
    }

    return Array.from(bins.entries()).map(([label, count]) => ({ label, count }))
  }, [trades])

  // MAE/MFE scatter
  const maeMfeData = useMemo(() => {
    return trades
      .filter((t) => t.mae !== null && t.mfe !== null)
      .map((t) => ({
        mae: Math.abs(t.mae!),
        mfe: t.mfe!,
        pnl: t.net_pnl,
        win: t.net_pnl > 0,
      }))
  }, [trades])

  // Drawdown
  const drawdownData = useMemo(() => {
    if (!trades.length) return []
    let peak = 0
    let cumulative = 0
    return trades.map((t) => {
      cumulative += t.net_pnl
      if (cumulative > peak) peak = cumulative
      const dd = peak > 0 ? ((cumulative - peak) / peak) * 100 : 0
      return {
        date: format(parseISO(t.entry_time), 'MM/dd'),
        drawdown: Math.round(dd * 10) / 10,
        cumulative,
      }
    })
  }, [trades])

  // Direction stats
  const directionData = useMemo(() => {
    const longs = trades.filter((t) => t.direction === 'long')
    const shorts = trades.filter((t) => t.direction === 'short')

    const stats = (arr: Trade[]) => {
      if (!arr.length) return { winRate: 0, avgPnL: 0, count: 0 }
      const winners = arr.filter((t) => t.net_pnl > 0)
      return {
        winRate: (winners.length / arr.length) * 100,
        avgPnL: arr.reduce((s, t) => s + t.net_pnl, 0) / arr.length,
        count: arr.length,
      }
    }

    const longStats = stats(longs)
    const shortStats = stats(shorts)

    return [
      { name: 'Long', winRate: longStats.winRate, avgPnL: longStats.avgPnL, count: longStats.count },
      { name: 'Short', winRate: shortStats.winRate, avgPnL: shortStats.avgPnL, count: shortStats.count },
    ]
  }, [trades])

  // Emotion stacked data
  const emotionData = useMemo(() => {
    const moods = ['calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident']
    return moods
      .filter((m) => trades.some((t) => t.mood === m))
      .map((mood) => {
        const moodTrades = trades.filter((t) => t.mood === mood)
        const wins = moodTrades.filter((t) => t.net_pnl > 0)
        const losses = moodTrades.filter((t) => t.net_pnl <= 0)
        const totalWins = wins.reduce((s, t) => s + t.net_pnl, 0)
        const totalLosses = losses.reduce((s, t) => s + t.net_pnl, 0)
        return { mood, totalWins, totalLosses: Math.abs(totalLosses), count: moodTrades.length }
      })
  }, [trades])

  // Overview stats
  const overviewStats = useMemo(() => {
    if (!trades.length) return null
    const winners = trades.filter((t) => t.net_pnl > 0)
    const losers = trades.filter((t) => t.net_pnl < 0)
    const totalPnL = trades.reduce((s, t) => s + t.net_pnl, 0)
    const avgWin = winners.length ? winners.reduce((s, t) => s + t.net_pnl, 0) / winners.length : 0
    const avgLoss = losers.length ? Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0) / losers.length) : 0
    const grossWins = winners.reduce((s, t) => s + t.net_pnl, 0)
    const grossLosses = Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0))
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : Infinity
    const maxDrawdown = drawdownData.length ? Math.min(...drawdownData.map((d) => d.drawdown)) : 0
    const bestTrade = trades.reduce((b, t) => t.net_pnl > b.net_pnl ? t : b, trades[0])
    const worstTrade = trades.reduce((w, t) => t.net_pnl < w.net_pnl ? t : w, trades[0])

    return {
      totalPnL, winners: winners.length, losers: losers.length, total: trades.length,
      winRate: (winners.length / trades.length) * 100, avgWin, avgLoss, profitFactor,
      maxDrawdown, bestTrade, worstTrade,
    }
  }, [trades, drawdownData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading reports...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reports & Analytics</h1>
        <p className="text-sm text-gray-400 mt-1">{trades.length} trades analyzed</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition',
              tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {overviewStats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total P&L', value: formatCurrency(overviewStats.totalPnL), color: overviewStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'Win Rate', value: `${overviewStats.winRate.toFixed(1)}%` },
                  { label: 'Profit Factor', value: overviewStats.profitFactor === Infinity ? '∞' : overviewStats.profitFactor.toFixed(2), color: overviewStats.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-yellow-400' },
                  { label: 'Max Drawdown', value: `${overviewStats.maxDrawdown.toFixed(1)}%`, color: 'text-red-400' },
                  { label: 'Avg Win', value: formatCurrency(overviewStats.avgWin), color: 'text-emerald-400' },
                  { label: 'Avg Loss', value: formatCurrency(-overviewStats.avgLoss), color: 'text-red-400' },
                  { label: 'Total Trades', value: overviewStats.total.toString() },
                  { label: 'Win/Loss', value: `${overviewStats.winners}W / ${overviewStats.losers}L` },
                ].map((stat) => (
                  <div key={stat.label} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
                    <p className="text-xs text-gray-400 font-medium">{stat.label}</p>
                    <p className={cn('text-xl font-bold mt-1', stat.color || 'text-white')}>{stat.value}</p>
                  </div>
                ))}
              </div>
              {/* Best/worst trade */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                  <p className="text-xs text-emerald-400 font-medium mb-2">Best Trade</p>
                  <p className="text-2xl font-bold text-emerald-400">{formatCurrency(overviewStats.bestTrade.net_pnl)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(parseISO(overviewStats.bestTrade.date), 'MMM d, yyyy')} — {overviewStats.bestTrade.direction.toUpperCase()} {overviewStats.bestTrade.quantity}ct @ {overviewStats.bestTrade.entry_price}
                  </p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                  <p className="text-xs text-red-400 font-medium mb-2">Worst Trade</p>
                  <p className="text-2xl font-bold text-red-400">{formatCurrency(overviewStats.worstTrade.net_pnl)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(parseISO(overviewStats.worstTrade.date), 'MMM d, yyyy')} — {overviewStats.worstTrade.direction.toUpperCase()} {overviewStats.worstTrade.quantity}ct @ {overviewStats.worstTrade.entry_price}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <EmptyState message="No trades yet — import trades to see reports" />
          )}
        </div>
      )}

      {/* Hourly P&L */}
      {tab === 'hourly' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Average P&L by Hour of Day</h3>
          {hourlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={hourlyData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <ReferenceLine y={0} stroke="#4b5563" />
                <Tooltip {...tooltipStyle} formatter={(v) => [formatCurrency(Number(v)), 'Avg P&L']} />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                  {hourlyData.map((entry, i) => (
                    <Cell key={i} fill={entry.avg >= 0 ? '#34d399' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No trade data available" />
          )}
        </div>
      )}

      {/* R-Multiple */}
      {tab === 'rmultiple' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">R-Multiple Distribution</h3>
          <p className="text-xs text-gray-500 mb-4">Requires stop_loss to be set on trades</p>
          {rMultipleData.some((d) => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={rMultipleData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v) => [Number(v), 'Trades']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {rMultipleData.map((entry, i) => {
                    const rVal = parseInt(entry.label)
                    return <Cell key={i} fill={rVal >= 0 ? '#34d399' : '#f87171'} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No trades with stop_loss set — annotate trades to see R-multiple distribution" />
          )}
        </div>
      )}

      {/* MAE/MFE Scatter */}
      {tab === 'maemfe' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">MAE vs MFE Analysis</h3>
          <p className="text-xs text-gray-500 mb-4">Max Adverse Excursion vs Max Favorable Excursion per trade</p>
          {maeMfeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="mae"
                  name="MAE (pts)"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'MAE (pts)', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  dataKey="mfe"
                  name="MFE (pts)"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'MFE (pts)', angle: -90, position: 'left', fill: '#6b7280', fontSize: 11 }}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value, name) => [Number(value).toFixed(2), String(name)]}
                />
                <Scatter
                  name="Winners"
                  data={maeMfeData.filter((d) => d.win)}
                  fill="#34d399"
                  opacity={0.7}
                />
                <Scatter
                  name="Losers"
                  data={maeMfeData.filter((d) => !d.win)}
                  fill="#f87171"
                  opacity={0.7}
                />
                <Legend />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No trades with MAE/MFE data — annotate trades to see this chart" />
          )}
        </div>
      )}

      {/* Drawdown */}
      {tab === 'drawdown' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Running Drawdown from Peak Equity</h3>
          {drawdownData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={drawdownData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <ReferenceLine y={0} stroke="#4b5563" />
                <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Drawdown']} />
                <Area type="monotone" dataKey="drawdown" stroke="#f87171" strokeWidth={2} fill="url(#ddGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No trade data available" />
          )}
        </div>
      )}

      {/* Direction */}
      {tab === 'direction' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Win Rate by Direction</h3>
            {directionData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={directionData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Win Rate']} />
                  <Bar dataKey="winRate" radius={[6, 6, 0, 0]}>
                    {directionData.map((entry, i) => (
                      <Cell key={i} fill={entry.name === 'Long' ? '#34d399' : '#f87171'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No data" />
            )}
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Avg P&L by Direction</h3>
            {directionData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={directionData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <ReferenceLine y={0} stroke="#4b5563" />
                  <Tooltip {...tooltipStyle} formatter={(v) => [formatCurrency(Number(v)), 'Avg P&L']} />
                  <Bar dataKey="avgPnL" radius={[6, 6, 0, 0]}>
                    {directionData.map((entry, i) => (
                      <Cell key={i} fill={entry.avgPnL >= 0 ? '#34d399' : '#f87171'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No data" />
            )}
          </div>

          {/* Summary table */}
          <div className="md:col-span-2 bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400">Direction</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Trades</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Win Rate</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Avg P&L</th>
                </tr>
              </thead>
              <tbody>
                {directionData.map((d) => (
                  <tr key={d.name} className="border-b border-gray-700/30">
                    <td className="px-5 py-3 font-medium" style={{ color: d.name === 'Long' ? '#34d399' : '#f87171' }}>{d.name}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{d.count}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{d.winRate.toFixed(1)}%</td>
                    <td className={cn('px-5 py-3 text-right font-semibold', d.avgPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {formatCurrency(d.avgPnL)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Emotion */}
      {tab === 'emotion' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">P&L by Mood (Wins vs Losses)</h3>
          {emotionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={emotionData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="mood" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip {...tooltipStyle} formatter={(v, name) => [formatCurrency(Number(v)), name === 'totalWins' ? 'Total Wins' : 'Total Losses']} />
                <Legend formatter={(value) => value === 'totalWins' ? 'Wins' : 'Losses'} />
                <Bar dataKey="totalWins" fill="#34d399" radius={[4, 4, 0, 0]} name="totalWins" />
                <Bar dataKey="totalLosses" fill="#f87171" radius={[4, 4, 0, 0]} name="totalLosses" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No mood-tagged trades yet — annotate trades to see emotion breakdown" />
          )}
        </div>
      )}
    </div>
  )
}
