'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn, formatCurrency } from '@/lib/utils'
import type { ComboResult, BracketSweepResponse } from '@/app/api/backtest/bracket-sweep/route'
import {
  SWEEP_STOP_TICKS as STOPS,
  SWEEP_TARGET_TICKS as TARGETS,
  PLAN_BRACKET,
  SWEEP_MIN_RESOLVED,
  SWEEP_MIN_RESOLVED_SHARE,
} from '@/lib/bracket-whatif'

// The trading plan's bracket (8-tick stop / 16-tick target) — outlined as "live".
const LIVE_STOP = PLAN_BRACKET.stopTicks
const LIVE_TARGET = PLAN_BRACKET.targetTicks
const signedCurrency = (v: number) => `${v >= 0 ? '+' : '−'}${formatCurrency(Math.abs(v))}`

function expectancyColor(value: number, maxAbs: number): string {
  if (maxAbs === 0) return 'rgba(75,85,99,0.4)'
  const intensity = Math.min(Math.abs(value) / maxAbs, 1)
  if (value > 0) {
    const s = Math.round(40 + intensity * 55)
    const l = Math.round(20 + intensity * 18)
    return `hsl(145,${s}%,${l}%)`
  } else {
    const s = Math.round(40 + intensity * 55)
    const l = Math.round(20 + intensity * 18)
    return `hsl(0,${s}%,${l}%)`
  }
}

export default function BracketsPage() {
  const router = useRouter()

  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [setup, setSetup] = useState('')
  const [direction, setDirection] = useState<'' | 'long' | 'short'>('')
  const [minGrade, setMinGrade] = useState<'' | 'A' | 'B' | 'C'>('')
  const [source, setSource] = useState<'combined' | 'live' | 'backtest'>('combined')

  const [data, setData] = useState<BracketSweepResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedCombo, setSelectedCombo] = useState<{ stop: number; target: number } | null>(null)

  const runSweep = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/backtest/bracket-sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          setup: setup || undefined,
          direction: direction || undefined,
          minGrade: minGrade || undefined,
          source,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Sweep failed')
      setData(json)
      setSelectedCombo(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, setup, direction, minGrade, source])

  // Best = highest expectancy among cells with enough known outcomes, both in
  // count and as a share of all trades (see SWEEP_MIN_RESOLVED_SHARE: wide
  // stops hide losses the way wide targets hide wins).
  const bestCombo = useMemo(() => {
    if (!data) return null
    return data.results
      .filter(r => r.expectancy !== null && r.resolved >= SWEEP_MIN_RESOLVED &&
        r.resolved >= r.total * SWEEP_MIN_RESOLVED_SHARE)
      .reduce<ComboResult | null>(
        (best, r) => (best === null || (r.expectancy ?? -Infinity) > (best.expectancy ?? -Infinity) ? r : best),
        null
      )
  }, [data])

  const maxAbsExpectancy = useMemo(() => {
    if (!data) return 0
    return Math.max(...data.results.map(r => Math.abs(r.expectancy ?? 0)), 1)
  }, [data])

  const detailCombo = useMemo(() => {
    if (!data || !selectedCombo) return null
    return (
      data.results.find(
        r => r.stopTicks === selectedCombo.stop && r.targetTicks === selectedCombo.target
      ) ?? null
    )
  }, [data, selectedCombo])

  function getCombo(stop: number, target: number): ComboResult | undefined {
    return data?.results.find(r => r.stopTicks === stop && r.targetTicks === target)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Bracket Sweep</h1>
        <p className="text-sm text-gray-400 mt-1">
          Replay logged trades against hypothetical bracket orders using recorded MAE/MFE
        </p>
      </div>

      {/* Top-level tabs — mirrors Backtest page nav */}
      <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1 w-fit">
        <button
          onClick={() => router.push('/backtest')}
          className="px-5 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition"
        >
          🎯 Blind Engine
        </button>
        <button
          onClick={() => router.push('/backtest')}
          className="px-5 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition"
        >
          📋 Session Log
        </button>
        <button className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white transition">
          📊 Bracket Sweep
        </button>
        <button
          onClick={() => router.push('/backtest/eval')}
          className="px-5 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition"
        >
          🎲 Eval
        </button>
      </div>

      {/* Current live bracket card */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-5 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-amber-300">Your Current Live Bracket</p>
          <p className="text-xs text-amber-400/70 mt-0.5">
            {LIVE_STOP}pt stop · {LIVE_TARGET}pt target — find this cell in the grid below
          </p>
        </div>
        <span className="font-mono text-sm text-amber-400/80">
          {LIVE_STOP}pt / {LIVE_TARGET}pt
        </span>
      </div>

      {/* Caveat */}
      <p className="text-xs text-gray-500 border border-gray-700/40 rounded-lg px-4 py-2.5 bg-gray-800/30">
        <span className="text-gray-400 font-medium">Note:</span> Manual-replay backtest trades can
        carry hindsight-optimistic MAE/MFE — you may recall how far price traveled. The{' '}
        <span className="text-emerald-400/80">Live Only</span> view is the honest benchmark as live
        sample grows.
      </p>

      {/* Filters */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Filters</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Setup Tag</label>
            <input
              type="text"
              value={setup}
              onChange={e => setSetup(e.target.value)}
              placeholder="e.g. ORB Break"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Direction</label>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as '' | 'long' | 'short')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Min Grade</label>
            <select
              value={minGrade}
              onChange={e => setMinGrade(e.target.value as '' | 'A' | 'B' | 'C')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Grades</option>
              <option value="C">C and above</option>
              <option value="B">B and above</option>
              <option value="A">A only</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Source</label>
            <select
              value={source}
              onChange={e => setSource(e.target.value as 'combined' | 'live' | 'backtest')}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="combined">Combined</option>
              <option value="live">Live Only</option>
              <option value="backtest">Backtest Only</option>
            </select>
          </div>
        </div>
        <button
          onClick={runSweep}
          disabled={loading}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
        >
          {loading ? 'Running sweep…' : 'Run Bracket Sweep'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Heatmap */}
      {data && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Expectancy Heatmap — every trade as 1 ES, in ticks</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {data.totalIncluded} trades · {data.liveCount} live · {data.backtestCount} backtest · expectancy at each
                cell&apos;s known win rate, fees included · n = known outcomes
              </p>
            </div>
            {bestCombo && bestCombo.expectancy !== null && (
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  Best combo (n ≥ {SWEEP_MIN_RESOLVED}, ≥ {Math.round(SWEEP_MIN_RESOLVED_SHARE * 100)}% known)
                </p>
                <p className="text-sm font-bold text-emerald-400">
                  {bestCombo.stopTicks}t stop / {bestCombo.targetTicks}t target
                </p>
                <p className="text-xs text-emerald-400/70">{signedCurrency(bestCombo.expectancy)}/trade · n={bestCombo.resolved}</p>
              </div>
            )}
          </div>

          {data.totalIncluded === 0 ? (
            <p className="text-center py-8 text-gray-500 text-sm">
              No trades matched your filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="inline-grid gap-1.5"
                style={{ gridTemplateColumns: `4.5rem repeat(${TARGETS.length}, 5.5rem)` }}
              >
                {/* Header row */}
                <div className="text-[10px] text-gray-500 text-right pr-2 self-end pb-1 leading-tight">
                  Stop ↓ / Target →
                </div>
                {TARGETS.map(t => (
                  <div key={t} className="text-xs font-medium text-gray-400 text-center pb-1">
                    {t}t
                  </div>
                ))}

                {/* Data rows */}
                {STOPS.map(stop => (
                  <>
                    <div
                      key={`label-${stop}`}
                      className="text-xs font-medium text-gray-400 text-right pr-2 self-center"
                    >
                      {stop}t
                    </div>
                    {TARGETS.map(target => {
                      const combo = getCombo(stop, target)
                      const exp = combo?.expectancy ?? 0
                      const bgColor = combo && combo.expectancy !== null
                        ? expectancyColor(exp, maxAbsExpectancy)
                        : 'rgba(75,85,99,0.2)'
                      const isLive = stop === LIVE_STOP && target === LIVE_TARGET
                      const isBest =
                        bestCombo?.stopTicks === stop && bestCombo?.targetTicks === target
                      const isSelected =
                        selectedCombo?.stop === stop && selectedCombo?.target === target
                      const tooltipText = combo
                        ? `${combo.wins}W / ${combo.losses}L known of ${combo.total} trades` +
                          (combo.winRate !== null ? ` · ${combo.winRate.toFixed(0)}% (break-even ${combo.breakevenRate.toFixed(0)}%)` : '') +
                          `\nUnknown: ${combo.orderUnknown + combo.exitedEarly}` +
                          (combo.expectancy !== null ? `\nExpectancy: ${signedCurrency(combo.expectancy)}/trade` : '')
                        : ''
                      return (
                        <button
                          key={`${stop}-${target}`}
                          onClick={() => setSelectedCombo({ stop, target })}
                          title={tooltipText}
                          className={cn(
                            'h-14 rounded-lg text-center text-xs font-semibold transition-opacity',
                            'flex flex-col items-center justify-center gap-0.5',
                            'border-2 hover:opacity-85 cursor-pointer',
                            isSelected
                              ? 'border-white'
                              : isLive
                              ? 'border-amber-400'
                              : isBest
                              ? 'border-emerald-400'
                              : 'border-transparent',
                          )}
                          style={{ backgroundColor: bgColor }}
                        >
                          <span className={exp >= 0 ? 'text-emerald-100' : 'text-red-100'}>
                            {combo && combo.expectancy !== null ? signedCurrency(exp) : '—'}
                          </span>
                          {combo && (
                            <span className="text-[9px] text-white/50 font-normal leading-none">n={combo.resolved}</span>
                          )}
                          {isLive && (
                            <span className="text-[9px] text-amber-300 font-bold leading-none">
                              LIVE
                            </span>
                          )}
                          {isBest && !isLive && (
                            <span className="text-[9px] text-emerald-300 font-bold leading-none">
                              BEST
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </>
                ))}
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded border-2 border-amber-400 bg-transparent" />
                  <span>Your plan bracket ({LIVE_STOP}t / {LIVE_TARGET}t)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded border-2 border-emerald-400 bg-transparent" />
                  <span>Best combo</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded border-2 border-white bg-transparent" />
                  <span>Selected (click any cell)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detail table for selected combo */}
      {detailCombo && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-200">
            Detail — {detailCombo.stopTicks}-tick stop / {detailCombo.targetTicks}-tick target · win{' '}
            {signedCurrency(detailCombo.winPnl)} · loss {signedCurrency(detailCombo.lossPnl)} · break-even{' '}
            {detailCombo.breakevenRate.toFixed(1)}%
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: 'Known outcomes',
                value: `${detailCombo.wins}W · ${detailCombo.losses}L`,
                color: 'text-gray-200',
              },
              {
                label: 'Known win rate',
                value: detailCombo.winRate === null ? '—' : `${detailCombo.winRate.toFixed(1)}%`,
                color: detailCombo.winRate !== null && detailCombo.winRate >= detailCombo.breakevenRate ? 'text-emerald-400' : 'text-yellow-400',
              },
              {
                label: 'Expectancy',
                value: detailCombo.expectancy === null ? '—' : `${signedCurrency(detailCombo.expectancy)}/trade`,
                color: (detailCombo.expectancy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: `All ${detailCombo.total}, estimated`,
                value: detailCombo.estimateAll === null ? '—' : signedCurrency(detailCombo.estimateAll),
                color: (detailCombo.estimateAll ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: 'Known net',
                value: signedCurrency(detailCombo.resolvedNet),
                color: detailCombo.resolvedNet >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: 'Range (unknowns lost … won)',
                value: `${signedCurrency(detailCombo.worstAll)} … ${signedCurrency(detailCombo.bestAll)}`,
                color: 'text-gray-300',
              },
              {
                label: 'Live / Backtest',
                value: `${detailCombo.liveCount} / ${detailCombo.backtestCount}`,
                color: 'text-gray-300',
              },
              {
                label: 'Definite · likely',
                value: `${detailCombo.definiteWin + detailCombo.definiteLoss} · ${detailCombo.likelyWin + detailCombo.likelyLoss}`,
                color: 'text-gray-300',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-900/40 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={cn('text-base font-bold tabular-nums', color)}>{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="bg-gray-900/40 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Exited early</p>
              <p className="text-base font-bold text-gray-300">{detailCombo.exitedEarly}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">
                Closed before reaching either level — the bracket would still be running, so the outcome is unknown
              </p>
            </div>
            <div className="bg-gray-900/40 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Order unknown</p>
              <p className="text-base font-bold text-amber-400">{detailCombo.orderUnknown}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">
                MAE reached the stop AND MFE reached the target — which came first isn&apos;t recorded
              </p>
            </div>
          </div>
          <p className="text-[10px] text-gray-600">
            Known outcomes lean toward losses as the target widens: a loss is proven by any close past the stop, a win only
            by MFE or a close at the full target. Log MFE/MAE on every trade to narrow the range.
          </p>
        </div>
      )}

      {/* Empty state before first run */}
      {!data && !loading && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-base font-medium text-gray-400">Configure filters and run the sweep</p>
          <p className="text-sm mt-1">The heatmap will appear here once results are ready</p>
        </div>
      )}
    </div>
  )
}
