'use client'

import { useMemo } from 'react'
import { BlindBacktestTrade } from '@/types'
import { cn } from '@/lib/utils'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, ReferenceLine, Cell,
} from 'recharts'

interface Props {
  trades: BlindBacktestTrade[]
  loading: boolean
}

interface SetupRow { setup: string; count: number; wins: number; losses: number; scratches: number; winRate: number; avgR: number | null; totalR: number }
interface CalibRow { confidence: number; count: number; wins: number; winRate: number }

const SETUP_ORDER = ['ORB', 'TTM Squeeze', 'AVWAP', 'FVG', 'Divergence']

function rColor(r: number | null) {
  if (r == null) return 'text-gray-500'
  return r >= 0 ? 'text-emerald-400' : 'text-red-400'
}

function pctColor(p: number) {
  if (p >= 60) return 'text-emerald-400'
  if (p >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

export default function StatsView({ trades, loading }: Props) {
  // Cumulative R curve
  const equity = useMemo(() => {
    const sorted = [...trades].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
    let cum = 0
    return sorted.map((t, i) => {
      const r = t.r_multiple ?? 0
      cum += r
      return { i: i + 1, cumR: Math.round(cum * 100) / 100, r }
    })
  }, [trades])

  const cumulativeR = equity.length ? equity[equity.length - 1].cumR : 0

  // By setup
  const bySetup = useMemo<SetupRow[]>(() => {
    const map: Record<string, BlindBacktestTrade[]> = {}
    for (const t of trades) {
      const key = t.trade_setup || 'Untagged'
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    const rows = Object.entries(map).map(([setup, ts]) => {
      const wins = ts.filter((t) => t.outcome === 'WIN').length
      const losses = ts.filter((t) => t.outcome === 'LOSS').length
      const scratches = ts.filter((t) => t.outcome === 'SCRATCH').length
      const decisive = wins + losses
      const rVals = ts.map((t) => t.r_multiple).filter((r): r is number => r != null)
      const totalR = rVals.reduce((s, r) => s + r, 0)
      return {
        setup, count: ts.length, wins, losses, scratches,
        winRate: decisive ? (wins / decisive) * 100 : 0,
        avgR: rVals.length ? totalR / rVals.length : null,
        totalR,
      }
    })
    rows.sort((a, b) => {
      const ai = SETUP_ORDER.indexOf(a.setup)
      const bi = SETUP_ORDER.indexOf(b.setup)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return b.count - a.count
    })
    return rows
  }, [trades])

  // By direction
  const byDirection = useMemo(() => {
    const out = { long: { count: 0, wins: 0, losses: 0, scratches: 0, totalR: 0 },
                  short: { count: 0, wins: 0, losses: 0, scratches: 0, totalR: 0 } }
    for (const t of trades) {
      const d = t.direction === 'short' ? 'short' : 'long'
      out[d].count++
      if (t.outcome === 'WIN') out[d].wins++
      else if (t.outcome === 'LOSS') out[d].losses++
      else if (t.outcome === 'SCRATCH') out[d].scratches++
      if (t.r_multiple != null) out[d].totalR += t.r_multiple
    }
    return out
  }, [trades])

  // Confidence calibration (1-5 vs win rate)
  const calibration = useMemo<CalibRow[]>(() => {
    const buckets: Record<number, BlindBacktestTrade[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] }
    for (const t of trades) {
      const c = t.confidence
      if (c != null && c >= 1 && c <= 5) buckets[c].push(t)
    }
    return [1, 2, 3, 4, 5].map((confidence) => {
      const ts = buckets[confidence]
      const wins = ts.filter((t) => t.outcome === 'WIN').length
      const decisive = ts.filter((t) => t.outcome === 'WIN' || t.outcome === 'LOSS').length
      return {
        confidence,
        count: ts.length,
        wins,
        winRate: decisive ? (wins / decisive) * 100 : 0,
      }
    })
  }, [trades])

  // AI vs Self grade agreement
  const gradeAgreement = useMemo(() => {
    const both = trades.filter((t) => t.ai_grade && t.self_grade)
    const agree = both.filter((t) => t.ai_grade === t.self_grade).length
    const harsher = both.filter((t) => gradeRank(t.self_grade) > gradeRank(t.ai_grade)).length
    const lenient = both.filter((t) => gradeRank(t.self_grade) < gradeRank(t.ai_grade)).length
    return { total: both.length, agree, harsher, lenient }
  }, [trades])

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-gray-800/50 border border-gray-700/50 rounded-xl animate-pulse h-32" />
        ))}
      </div>
    )
  }

  if (trades.length === 0) {
    return (
      <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-8 text-center text-sm text-gray-500">
        Complete some blind backtest trades to see your performance breakdown.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Cumulative R curve */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">Cumulative R</h3>
            <p className="text-xs text-gray-500 mt-0.5">{equity.length} trades · running total of R-multiples</p>
          </div>
          <p className={cn('text-2xl font-bold', cumulativeR >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {cumulativeR > 0 ? '+' : ''}{cumulativeR.toFixed(2)}R
          </p>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equity}>
              <defs>
                <linearGradient id="cumR" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={cumulativeR >= 0 ? '#34d399' : '#f87171'} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={cumulativeR >= 0 ? '#34d399' : '#f87171'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="i" stroke="#6b7280" tick={{ fontSize: 11 }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(v) => {
                  const num = typeof v === 'number' ? v : 0
                  return [`${num > 0 ? '+' : ''}${num.toFixed(2)}R`, 'Cumulative']
                }}
              />
              <ReferenceLine y={0} stroke="#374151" />
              <Area type="monotone" dataKey="cumR" stroke={cumulativeR >= 0 ? '#34d399' : '#f87171'} strokeWidth={2} fill="url(#cumR)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By Setup */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-700/50">
          <h3 className="text-sm font-semibold text-gray-200">Performance by Setup</h3>
          <p className="text-xs text-gray-500 mt-0.5">Win rate excludes scratches</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700/50 text-xs text-gray-500">
                <th className="text-left px-4 py-2 font-medium">Setup</th>
                <th className="text-center px-4 py-2 font-medium">Trades</th>
                <th className="text-center px-4 py-2 font-medium">W / L / S</th>
                <th className="text-center px-4 py-2 font-medium">Win Rate</th>
                <th className="text-right px-4 py-2 font-medium">Avg R</th>
                <th className="text-right px-4 py-2 font-medium">Total R</th>
              </tr>
            </thead>
            <tbody>
              {bySetup.map((row) => (
                <tr key={row.setup} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                  <td className="px-4 py-2.5 text-gray-300 font-medium">{row.setup}</td>
                  <td className="px-4 py-2.5 text-center text-gray-400">{row.count}</td>
                  <td className="px-4 py-2.5 text-center text-xs">
                    <span className="text-emerald-400">{row.wins}</span>
                    <span className="text-gray-600 mx-1">/</span>
                    <span className="text-red-400">{row.losses}</span>
                    <span className="text-gray-600 mx-1">/</span>
                    <span className="text-gray-500">{row.scratches}</span>
                  </td>
                  <td className={cn('px-4 py-2.5 text-center font-semibold', pctColor(row.winRate))}>
                    {row.winRate.toFixed(0)}%
                  </td>
                  <td className={cn('px-4 py-2.5 text-right font-mono font-semibold', rColor(row.avgR))}>
                    {row.avgR != null ? `${row.avgR > 0 ? '+' : ''}${row.avgR.toFixed(2)}R` : '—'}
                  </td>
                  <td className={cn('px-4 py-2.5 text-right font-mono font-semibold', rColor(row.totalR))}>
                    {row.totalR > 0 ? '+' : ''}{row.totalR.toFixed(2)}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confidence calibration */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-200">Confidence Calibration</h3>
          <p className="text-xs text-gray-500 mt-0.5">Do your high-confidence trades actually win more?</p>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={calibration}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="confidence" stroke="#6b7280" tick={{ fontSize: 11 }} label={{ value: 'Confidence (1–5)', position: 'insideBottom', offset: -4, fill: '#6b7280', fontSize: 11 }} />
              <YAxis stroke="#6b7280" tick={{ fontSize: 11 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#9ca3af' }}
                formatter={(_v, _k, item) => {
                  const row = (item?.payload ?? null) as CalibRow | null
                  if (!row) return ['—', 'Win Rate']
                  return [`${row.winRate.toFixed(0)}% (${row.wins}/${row.count})`, 'Win Rate']
                }}
              />
              <ReferenceLine y={50} stroke="#374151" strokeDasharray="4 4" />
              <Bar dataKey="winRate" radius={[6, 6, 0, 0]}>
                {calibration.map((row) => (
                  <Cell key={row.confidence} fill={row.count === 0 ? '#374151' : row.winRate >= 60 ? '#34d399' : row.winRate >= 50 ? '#eab308' : '#f87171'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-5 gap-2 mt-3">
          {calibration.map((row) => (
            <div key={row.confidence} className="text-center text-xs">
              <p className="text-gray-500">{row.confidence}/5</p>
              <p className="text-gray-400">{row.count} trade{row.count !== 1 ? 's' : ''}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Direction + Grade Agreement side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* By direction */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">By Direction</h3>
          <div className="space-y-3">
            {(['long', 'short'] as const).map((d) => {
              const row = byDirection[d]
              const decisive = row.wins + row.losses
              const winRate = decisive ? (row.wins / decisive) * 100 : 0
              const avgR = row.count ? row.totalR / row.count : 0
              return (
                <div key={d}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={cn('text-sm font-semibold capitalize',
                      d === 'long' ? 'text-emerald-400' : 'text-red-400')}>
                      {d === 'long' ? '▲ Long' : '▼ Short'}
                    </span>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-gray-500">{row.count} trades</span>
                      <span className={cn('font-semibold', pctColor(winRate))}>{winRate.toFixed(0)}%</span>
                      <span className={cn('font-mono font-semibold', rColor(avgR))}>
                        {avgR > 0 ? '+' : ''}{avgR.toFixed(2)}R avg
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                    {row.count > 0 && (
                      <>
                        <div className="bg-emerald-500" style={{ width: `${(row.wins / row.count) * 100}%` }} />
                        <div className="bg-red-500" style={{ width: `${(row.losses / row.count) * 100}%` }} />
                        <div className="bg-gray-500" style={{ width: `${(row.scratches / row.count) * 100}%` }} />
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* AI vs Self grade */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">AI vs Self Grading</h3>
          <p className="text-xs text-gray-500 mb-4">How does your judgment compare to the coach?</p>
          {gradeAgreement.total === 0 ? (
            <p className="text-sm text-gray-500">No trades with both grades yet.</p>
          ) : (
            <div className="space-y-2.5 text-sm">
              <Row label="Agreed" count={gradeAgreement.agree} total={gradeAgreement.total} color="text-emerald-400" />
              <Row label="You graded harsher" count={gradeAgreement.harsher} total={gradeAgreement.total} color="text-yellow-400" />
              <Row label="You graded easier" count={gradeAgreement.lenient} total={gradeAgreement.total} color="text-red-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total ? (count / total) * 100 : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-gray-300">{label}</span>
        <span className={cn('font-semibold text-xs', color)}>{count} ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full',
          color === 'text-emerald-400' ? 'bg-emerald-500' :
          color === 'text-yellow-400' ? 'bg-yellow-500' : 'bg-red-500')}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function gradeRank(g: string | null): number {
  if (g === 'A') return 0
  if (g === 'B') return 1
  if (g === 'C') return 2
  return -1
}
