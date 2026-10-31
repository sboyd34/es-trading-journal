'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { cn, formatCurrency } from '@/lib/utils'
import type { EvalMonteCarloResponse, ComboComparison } from '@/app/api/backtest/eval-monte-carlo/route'

const LS_KEY = 'apex.eval.lastResult'

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#f3f4f6',
  },
}

function passProbColor(p: number): string {
  if (p >= 60) return 'text-emerald-400'
  if (p >= 35) return 'text-amber-400'
  return 'text-red-400'
}

function NumInput({
  label, value, onChange, step = 1, min, className,
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  step?: number
  min?: number
  className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        value={value ?? ''}
        onChange={e => {
          const raw = e.target.value
          if (raw === '') return onChange(null)
          const n = parseFloat(raw)
          onChange(Number.isNaN(n) ? null : n)
        }}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}

export default function EvalPage() {
  const router = useRouter()

  // Simulation inputs — prefilled with live position
  const [startingEquity,   setStartingEquity]   = useState(250_000)
  const [profitTarget,     setProfitTarget]      = useState(15_000)
  const [trailingDrawdown, setTrailingDrawdown]  = useState(6_500)
  const [riskPerTrade,     setRiskPerTrade]      = useState(500)
  const [tradesPerDay,     setTradesPerDay]      = useState(2.5)
  const [currentEquity,    setCurrentEquity]     = useState<number | null>(null)
  const [currentThreshold, setCurrentThreshold]  = useState<number | null>(null)
  const [numSimulations,   setNumSimulations]    = useState(10_000)

  const [result,       setResult]       = useState<EvalMonteCarloResponse | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [selectedRisk, setSelectedRisk] = useState<number | null>(null)

  const runSimulation = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/backtest/eval-monte-carlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startingEquity, profitTarget, trailingDrawdown, riskPerTrade,
          tradesPerDay, numSimulations,
          ...(currentEquity    !== null ? { currentEquity }    : {}),
          ...(currentThreshold !== null ? { currentThreshold } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error((json as { error?: string }).error ?? 'Simulation failed')
      setResult(json as EvalMonteCarloResponse)
      setSelectedRisk(null)
      // Save compact result to localStorage for dashboard card
      try {
        const data = json as EvalMonteCarloResponse
        localStorage.setItem(LS_KEY, JSON.stringify({
          passProb:   data.passProb,
          passProbCI: data.passProbCI,
          verdict:    data.adequacy.verdict,
          riskPerTrade,
          runAt: new Date().toISOString(),
        }))
      } catch {
        // localStorage may be unavailable in some environments
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [startingEquity, profitTarget, trailingDrawdown, riskPerTrade,
      tradesPerDay, currentEquity, currentThreshold, numSimulations])

  const passLevel = startingEquity + profitTarget

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Apex Eval Simulator</h1>
        <p className="text-sm text-gray-400 mt-1">
          Monte Carlo pass-probability for the 250K evaluation using your actual R-multiple history
        </p>
      </div>

      {/* Nav tabs — mirrors Backtest page */}
      <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1 w-fit">
        {[
          { label: '🎯 Blind Engine',  path: '/backtest' },
          { label: '📋 Session Log',   path: '/backtest' },
          { label: '📊 Bracket Sweep', path: '/backtest/brackets' },
        ].map(({ label, path }) => (
          <button
            key={label}
            onClick={() => router.push(path)}
            className="px-5 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition"
          >
            {label}
          </button>
        ))}
        <button className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white transition">
          🎲 Eval
        </button>
      </div>

      {/* Simulation inputs */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Simulation Inputs</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumInput label="Starting Equity ($)"   value={startingEquity}   onChange={v => setStartingEquity(v ?? 250_000)}   step={1000}  />
          <NumInput label="Profit Target ($)"      value={profitTarget}     onChange={v => setProfitTarget(v ?? 15_000)}     step={500}   />
          <NumInput label="Trailing Drawdown ($)"  value={trailingDrawdown} onChange={v => setTrailingDrawdown(v ?? 6_500)} step={100}   />
          <NumInput label="Risk Per Trade ($)"     value={riskPerTrade}     onChange={v => setRiskPerTrade(v ?? 50)}         step={50}  min={50}  />
          <NumInput label="Trades Per Day"         value={tradesPerDay}     onChange={v => setTradesPerDay(v ?? 0.5)}        step={0.5} min={0.5} />
          <NumInput label="Current Equity ($) — blank uses live account balance"    value={currentEquity}    onChange={setCurrentEquity}    step={0.01}  />
          <NumInput label="Current Threshold ($) — blank uses live account balance" value={currentThreshold} onChange={setCurrentThreshold} step={0.01}  />
          <NumInput
            label="Simulations"
            value={numSimulations}
            onChange={v => setNumSimulations(Math.min(Math.max(Math.round(v ?? 1_000), 1_000), 20_000))}
            step={1000}
            min={1000}
          />
        </div>
        <div className="flex items-end gap-4 flex-wrap">
          <button
            onClick={runSimulation}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
          >
            {loading ? 'Simulating…' : 'Run Simulation'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Stability caveat */}
          <div className="bg-gray-800/30 border border-gray-700/40 rounded-lg px-4 py-2.5 text-xs text-gray-500 space-y-1">
            <p>
              <span className="text-gray-400 font-medium">Where the error comes from:</span>{' '}
              <span className="text-gray-300 font-medium">±{result.mcStdErr.toFixed(2)}pt</span>{' '}
              from running {numSimulations.toLocaleString()} simulations ·{' '}
              <span className="text-gray-300 font-medium">±{result.estimationStdErr.toFixed(1)}pt</span>{' '}
              from having only {result.adequacy.tradeCount} trades across{' '}
              {result.adequacy.distinctDays} days. More simulations shrink the first number
              and leave the second untouched.
            </p>
            <p className="text-gray-600">{result.riskInferenceNote}</p>
          </div>

          {/* Pass probability headline */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="col-span-2 md:col-span-1 flex flex-col justify-center">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Pass Probability</p>

                {result.adequacy.verdict === 'adequate' && (
                  <>
                    <p className={cn('text-5xl font-bold tabular-nums', passProbColor(result.passProb))}>
                      {result.passProb.toFixed(1)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      ± {result.estimationStdErr.toFixed(1)}pt
                    </p>
                  </>
                )}

                {result.adequacy.verdict === 'directional' && (
                  <>
                    <p className="text-4xl font-bold tabular-nums text-amber-400">
                      {result.passProbCI[0].toFixed(0)}–{result.passProbCI[1].toFixed(0)}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      directional only · point estimate {result.passProb.toFixed(1)}%
                    </p>
                  </>
                )}

                {result.adequacy.verdict === 'insufficient' && (
                  <>
                    <p className="text-2xl font-bold text-gray-400">Not enough data</p>
                    <p className="text-xs text-gray-500 mt-1">
                      95% interval spans {result.passProbCI[0].toFixed(0)}–
                      {result.passProbCI[1].toFixed(0)}% — too wide to act on
                    </p>
                  </>
                )}

                <p className="text-xs text-gray-500 mt-2">
                  ${riskPerTrade}/trade · {numSimulations.toLocaleString()} sims
                </p>
              </div>
              {[
                { label: 'Fail Prob',        value: `${result.failProb.toFixed(1)}%`,    color: 'text-red-400'     },
                { label: 'Timeout (>120d)',   value: `${result.timeoutProb.toFixed(1)}%`, color: 'text-gray-400'    },
                { label: 'Median Days Pass',  value: result.medianDaysToPass != null ? `${result.medianDaysToPass}d` : '—', color: 'text-blue-400'     },
                { label: 'P10 Days Pass',     value: result.p10DaysToPass    != null ? `${result.p10DaysToPass}d`    : '—', color: 'text-emerald-400' },
                { label: 'P90 Days Pass',     value: result.p90DaysToPass    != null ? `${result.p90DaysToPass}d`    : '—', color: 'text-amber-400'   },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-900/40 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className={cn('text-xl font-bold', color)}>{value}</p>
                </div>
              ))}
            </div>
          </div>

          {result.adequacy.blockers.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
              <p className="text-xs font-semibold text-amber-300 mb-2">What&rsquo;s missing</p>
              <ul className="space-y-1">
                {result.adequacy.blockers.map(b => (
                  <li key={b} className="flex gap-2 text-xs text-amber-200/80">
                    <span className="text-amber-500">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Equity fan chart */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-200 mb-1">Equity Path Percentiles</h2>
            <p className="text-xs text-gray-500 mb-4">
              Simulated equity over 120 trading days — paths held at terminal value after pass/fail
            </p>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart
                data={result.fanData}
                margin={{ top: 5, right: 60, left: 15, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  label={{ value: 'Trading Days', position: 'insideBottom', offset: -10, fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  domain={['auto', 'auto']}
                />
                <ReferenceLine
                  y={passLevel}
                  stroke="#10b981"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  label={{ value: 'Pass target', position: 'right', fill: '#10b981', fontSize: 10 }}
                />
                <ReferenceLine
                  y={result.resolvedThreshold}
                  stroke="#ef4444"
                  strokeWidth={1}
                  strokeDasharray="4 2"
                  label={{ value: 'Threshold', position: 'right', fill: '#ef4444', fontSize: 10 }}
                />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [formatCurrency(Number(v)), '']}
                  labelFormatter={(d: unknown) => `Day ${d}`}
                />
                <Line dataKey="p90" name="90th %" stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                <Line dataKey="p75" name="75th %" stroke="#60a5fa" strokeWidth={1}   strokeDasharray="3 2" dot={false} />
                <Line dataKey="p50" name="Median"  stroke="#3b82f6" strokeWidth={2.5}                      dot={false} />
                <Line dataKey="p25" name="25th %" stroke="#60a5fa" strokeWidth={1}   strokeDasharray="3 2" dot={false} />
                <Line dataKey="p10" name="10th %" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Risk comparison table */}
          {!result.adequacy.suppressRiskComparison && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-700/50">
                <h2 className="text-sm font-semibold text-gray-200">Risk Per Trade Comparison</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Same R distribution replayed at four risk levels — click a row to highlight
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      {['Risk/Trade', 'Pass %', 'Fail %', 'Timeout %', 'Median Days to Pass'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-400 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rComparison.map((row: ComboComparison) => {
                      const isSelected = selectedRisk === row.riskPerTrade
                      const isCurrent  = row.riskPerTrade === riskPerTrade
                      return (
                        <tr
                          key={row.riskPerTrade}
                          onClick={() => setSelectedRisk(isSelected ? null : row.riskPerTrade)}
                          className={cn(
                            'border-b border-gray-700/30 cursor-pointer transition',
                            isSelected ? 'bg-blue-600/10' : 'hover:bg-gray-700/20',
                          )}
                        >
                          <td className="px-4 py-3 text-gray-300 font-medium">
                            ${row.riskPerTrade}
                            {isCurrent && (
                              <span className="ml-2 text-[10px] bg-blue-600/30 text-blue-300 px-1.5 py-0.5 rounded font-semibold">
                                current
                              </span>
                            )}
                          </td>
                          <td className={cn('px-4 py-3 font-semibold', passProbColor(row.passProb))}>
                            {row.passProb.toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 text-red-400">{row.failProb.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-gray-400">{row.timeoutProb.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-blue-400">
                            {row.medianDaysToPass != null ? `${row.medianDaysToPass}d` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.adequacy.suppressRiskComparison && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-200">Risk Per Trade Comparison</h2>
              <p className="text-xs text-gray-500 mt-1">
                Hidden: only {result.adequacy.tradeCount > 0
                  ? Math.round(result.adequacy.stopCoverage * 100)
                  : 0}% of trades have a usable stop. For the rest, R is net P&amp;L ÷ the
                assumed risk, so replaying them at a different risk level just rescales the
                same number. The comparison would show arithmetic, not evidence.
              </p>
            </div>
          )}
        </>
      )}

      {!result && !loading && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-base font-medium text-gray-400">Configure inputs and run the simulation</p>
          <p className="text-sm mt-1">
            Results appear here — pass probability, equity fan chart, and risk comparison
          </p>
        </div>
      )}
    </div>
  )
}
