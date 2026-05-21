'use client'

import { useState, useMemo } from 'react'
import { Trade, RiskRules } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'
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
  Legend,
  LineChart,
  Line,
} from 'recharts'
import { Shuffle } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  trades: Trade[]
  riskRules: RiskRules | null
}

const tooltipStyle = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#f3f4f6',
  },
}

interface MonteCarloResult {
  fanData: Array<{ trade: number; p5: number; p25: number; p50: number; p75: number; p95: number }>
  histogram: Array<{ bin: string; count: number; positive: boolean }>
  maxDDHistogram: Array<{ midpoint: number; count: number; aboveThreshold: boolean }>
  probProfit: number
  median: number
  p5: number
  p95: number
  expectedValue: number
  ruinProb: number
}

export default function MonteCarloTab({ trades, riskRules }: Props) {
  const [mcNumTrades, setMcNumTrades] = useState(50)
  const [mcRunCount, setMcRunCount] = useState(0)
  const [mcRuinThreshold, setMcRuinThreshold] = useState(
    () => riskRules?.max_daily_loss ?? 1500,
  )

  const monteCarloResult = useMemo((): MonteCarloResult | null => {
    if (trades.length < 5 || mcRunCount === 0) return null
    const NUM_SIMS = 1000
    const N = Math.min(Math.max(mcNumTrades, 10), 200)

    const stepValues: number[][] = Array.from({ length: N + 1 }, () => [])
    const maxDDs: number[] = []
    let ruinedCount = 0

    for (let sim = 0; sim < NUM_SIMS; sim++) {
      let cum = 0
      let peak = 0
      let maxDD = 0
      let ruined = false
      stepValues[0].push(0)
      for (let t = 0; t < N; t++) {
        cum += trades[Math.floor(Math.random() * trades.length)].net_pnl
        if (cum > peak) peak = cum
        const dd = peak - cum
        if (dd > maxDD) maxDD = dd
        if (cum <= -mcRuinThreshold) ruined = true
        stepValues[t + 1].push(cum)
      }
      maxDDs.push(maxDD)
      if (ruined) ruinedCount++
    }

    const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p)] ?? 0

    const stride = Math.max(1, Math.floor(N / 50))
    const steps: number[] = []
    for (let i = 0; i <= N; i += stride) steps.push(i)
    if (steps[steps.length - 1] !== N) steps.push(N)

    const fanData = steps.map((step) => {
      const sorted = [...stepValues[step]].sort((a, b) => a - b)
      return {
        trade: step,
        p5: pct(sorted, 0.05),
        p25: pct(sorted, 0.25),
        p50: pct(sorted, 0.5),
        p75: pct(sorted, 0.75),
        p95: pct(sorted, 0.95),
      }
    })

    const finals = stepValues[N]
    const sortedFinals = [...finals].sort((a, b) => a - b)
    const fMin = sortedFinals[0]
    const fMax = sortedFinals[sortedFinals.length - 1]
    const BIN_COUNT = 25
    const fBinWidth = (fMax - fMin) / BIN_COUNT || 1
    const histogram = Array.from({ length: BIN_COUNT }, (_, i) => {
      const lo = fMin + i * fBinWidth
      const hi = lo + fBinWidth
      const count = finals.filter((v) =>
        i === BIN_COUNT - 1 ? v >= lo && v <= hi : v >= lo && v < hi,
      ).length
      return { bin: `$${Math.round(lo + fBinWidth / 2)}`, count, positive: lo + fBinWidth / 2 >= 0 }
    })

    const sortedDDs = [...maxDDs].sort((a, b) => a - b)
    const ddMin = sortedDDs[0]
    const ddMax = sortedDDs[sortedDDs.length - 1]
    const ddBinWidth = (ddMax - ddMin) / BIN_COUNT || 1
    const maxDDHistogram = Array.from({ length: BIN_COUNT }, (_, i) => {
      const lo = ddMin + i * ddBinWidth
      const hi = lo + ddBinWidth
      const midpoint = lo + ddBinWidth / 2
      const count = maxDDs.filter((v) =>
        i === BIN_COUNT - 1 ? v >= lo && v <= hi : v >= lo && v < hi,
      ).length
      return { midpoint, count, aboveThreshold: midpoint > mcRuinThreshold }
    })

    return {
      fanData,
      histogram,
      maxDDHistogram,
      probProfit: (finals.filter((v) => v > 0).length / finals.length) * 100,
      median: pct(sortedFinals, 0.5),
      p5: pct(sortedFinals, 0.05),
      p95: pct(sortedFinals, 0.95),
      expectedValue: finals.reduce((s, v) => s + v, 0) / finals.length,
      ruinProb: (ruinedCount / NUM_SIMS) * 100,
    }
  }, [trades, mcNumTrades, mcRunCount, mcRuinThreshold])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-white">Monte Carlo Simulator</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            1,000 random trade sequences sampled from your history to forecast P&L distribution.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">Trades per path:</label>
            <input
              type="number"
              min={10}
              max={200}
              step={10}
              value={mcNumTrades}
              onChange={(e) => setMcNumTrades(parseInt(e.target.value) || 50)}
              className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">Ruin threshold ($):</label>
            <input
              type="number"
              min={100}
              step={100}
              value={mcRuinThreshold}
              onChange={(e) => setMcRuinThreshold(parseInt(e.target.value) || 1500)}
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>
          <button
            onClick={() => {
              if (trades.length < 5) {
                toast.error('Need at least 5 trades to run simulation')
                return
              }
              setMcRunCount((c) => c + 1)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-xl transition"
          >
            <Shuffle className="h-4 w-4" />
            {mcRunCount === 0 ? 'Run Simulation' : 'Re-Run'}
          </button>
        </div>
      </div>

      {mcRunCount === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700/50 border-dashed rounded-xl p-12 text-center">
          <Shuffle className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 font-medium">No simulation run yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Click &ldquo;Run Simulation&rdquo; to generate 1,000 random trade sequences based on your history.
          </p>
          <p className="text-gray-700 text-xs mt-2">Requires at least 5 trades.</p>
        </div>
      ) : monteCarloResult ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              {
                label: 'Prob. of Profit',
                value: `${monteCarloResult.probProfit.toFixed(1)}%`,
                color: monteCarloResult.probProfit >= 50 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: 'Median Outcome',
                value: formatCurrency(monteCarloResult.median),
                color: monteCarloResult.median >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: '5th Pct (Worst 5%)',
                value: formatCurrency(monteCarloResult.p5),
                color: 'text-red-400',
              },
              {
                label: '95th Pct (Best 5%)',
                value: formatCurrency(monteCarloResult.p95),
                color: 'text-emerald-400',
              },
              {
                label: 'Expected Value',
                value: formatCurrency(monteCarloResult.expectedValue),
                color: monteCarloResult.expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: 'Ruin Probability',
                value: `${monteCarloResult.ruinProb.toFixed(1)}%`,
                color:
                  monteCarloResult.ruinProb > 10
                    ? 'text-red-400'
                    : monteCarloResult.ruinProb > 5
                      ? 'text-amber-400'
                      : 'text-emerald-400',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4"
              >
                <p className="text-xs text-gray-400 font-medium">{stat.label}</p>
                <p className={cn('text-xl font-bold mt-1', stat.color)}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-300 mb-4">
              Equity Path Percentiles — {mcNumTrades} trades
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={monteCarloResult.fanData}
                margin={{ top: 5, right: 10, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="trade"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  label={{
                    value: 'Trade #',
                    position: 'insideBottom',
                    offset: -10,
                    fill: '#6b7280',
                    fontSize: 11,
                  }}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 2" />
                <Tooltip
                  {...tooltipStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any, name: any) => [formatCurrency(Number(v)), name]}
                />
                <Line dataKey="p95" name="95th %" stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                <Line dataKey="p75" name="75th %" stroke="#60a5fa" strokeWidth={1} strokeDasharray="3 2" dot={false} />
                <Line dataKey="p50" name="Median" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                <Line dataKey="p25" name="25th %" stroke="#60a5fa" strokeWidth={1} strokeDasharray="3 2" dot={false} />
                <Line dataKey="p5" name="5th %" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-300 mb-4">
              Final P&L Distribution after {mcNumTrades} trades
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={monteCarloResult.histogram}
                margin={{ top: 5, right: 10, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="bin"
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  interval={4}
                  angle={-30}
                  textAnchor="end"
                />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip
                  {...tooltipStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [v, 'Simulations']}
                />
                <Bar dataKey="count" name="Simulations">
                  {monteCarloResult.histogram.map((entry, index) => (
                    <Cell key={index} fill={entry.positive ? '#10b981' : '#ef4444'} opacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-600 mt-3 text-center">
              Based on 1,000 simulations sampling randomly (with replacement) from your{' '}
              {trades.length} historical trades.
            </p>
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-300 mb-4">
              Max Drawdown Distribution — {mcNumTrades} trades
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={monteCarloResult.maxDDHistogram}
                margin={{ top: 5, right: 10, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="midpoint"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`
                  }
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickCount={8}
                />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <ReferenceLine
                  x={mcRuinThreshold}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  label={{ value: 'Ruin', position: 'top', fill: '#ef4444', fontSize: 10 }}
                />
                <Tooltip
                  {...tooltipStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [v, 'Simulations']}
                  labelFormatter={(v) =>
                    `Max DD: ${Number(v) >= 1000 ? `$${(Number(v) / 1000).toFixed(1)}k` : `$${Math.round(Number(v))}`}`
                  }
                />
                <Bar dataKey="count" name="Simulations">
                  {monteCarloResult.maxDDHistogram.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.aboveThreshold ? '#ef4444' : '#6b7280'}
                      opacity={0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-600 mt-3 text-center">
              Peak-to-trough drawdown across 1,000 paths. Red line = your ruin threshold.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
