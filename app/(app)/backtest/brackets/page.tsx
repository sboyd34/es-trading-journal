'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { cn, formatCurrency } from '@/lib/utils'
import type { ComboResult, BracketSweepResponse } from '@/app/api/backtest/bracket-sweep/route'

const STOPS = [6, 8, 10, 12, 14]
const TARGETS = [10, 12, 15, 18, 20, 24]

const LIVE_STOP = 10
const LIVE_TARGET = 20

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

  const bestCombo = useMemo(() => {
    if (!data) return null
    return data.results
      .filter(r => r.tradeCount > 0)
      .reduce<ComboResult | null>(
        (best, r) => (best === null || r.expectancy > best.expectancy ? r : best),
        null
      )
  }, [data])

  const maxAbsExpectancy = useMemo(() => {
    if (!data) return 0
    return Math.max(...data.results.map(r => Math.abs(r.expectancy)), 1)
  }, [data])

  const detailCombo = useMemo(() => {
    if (!data || !selectedCombo) return null
    return (
      data.results.find(
        r => r.stop === selectedCombo.stop && r.target === selectedCombo.target
      ) ?? null
    )
  }, [data, selectedCombo])

  function getCombo(stop: number, target: number): ComboResult | undefined {
    return data?.results.find(r => r.stop === stop && r.target === target)
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
              <h2 className="text-sm font-semibold text-gray-200">Expectancy Heatmap</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {data.totalIncluded} trades included · {data.excludedCount} excluded (no MAE/MFE) ·{' '}
                {data.liveCount} live · {data.backtestCount} backtest
              </p>
            </div>
            {bestCombo && (
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase tracking-wide">Best combo</p>
                <p className="text-sm font-bold text-emerald-400">
                  {bestCombo.stop}pt stop / {bestCombo.target}pt target
                </p>
                <p className="text-xs text-emerald-400/70">{formatCurrency(bestCombo.expectancy)}/trade</p>
              </div>
            )}
          </div>

          {data.totalIncluded === 0 ? (
            <p className="text-center py-8 text-gray-500 text-sm">
              No trades with MAE/MFE data matched your filters.
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
                    {t}pt
                  </div>
                ))}

                {/* Data rows */}
                {STOPS.map(stop => (
                  <>
                    <div
                      key={`label-${stop}`}
                      className="text-xs font-medium text-gray-400 text-right pr-2 self-center"
                    >
                      {stop}pt
                    </div>
                    {TARGETS.map(target => {
                      const combo = getCombo(stop, target)
                      const exp = combo?.expectancy ?? 0
                      const bgColor = combo
                        ? expectancyColor(exp, maxAbsExpectancy)
                        : 'rgba(75,85,99,0.2)'
                      const isLive = stop === LIVE_STOP && target === LIVE_TARGET
                      const isBest =
                        bestCombo?.stop === stop && bestCombo?.target === target
                      const isSelected =
                        selectedCombo?.stop === stop && selectedCombo?.target === target
                      const tooltipText = combo
                        ? `${combo.tradeCount} trades · ${combo.liveCount} live / ${combo.backtestCount} backtest\nWin rate: ${combo.winRate.toFixed(0)}%\nExpectancy: ${formatCurrency(exp)}`
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
                            {combo ? formatCurrency(exp) : '—'}
                          </span>
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
                  <span>Your live bracket</span>
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
            Detail — {detailCombo.stop}pt Stop / {detailCombo.target}pt Target
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              {
                label: 'Trades',
                value: detailCombo.tradeCount.toString(),
                color: 'text-white',
              },
              {
                label: 'Win Rate',
                value: `${detailCombo.winRate.toFixed(1)}%`,
                color: detailCombo.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400',
              },
              {
                label: 'Expectancy',
                value: formatCurrency(detailCombo.expectancy),
                color: detailCombo.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: 'Total P&L',
                value: formatCurrency(detailCombo.totalPnL),
                color: detailCombo.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: 'Profit Factor',
                value:
                  detailCombo.profitFactor === Infinity
                    ? '∞'
                    : detailCombo.profitFactor.toFixed(2),
                color: detailCombo.profitFactor >= 1 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: 'Max Consec Losses',
                value: detailCombo.maxConsecLosses.toString(),
                color: detailCombo.maxConsecLosses >= 5 ? 'text-red-400' : 'text-yellow-400',
              },
              {
                label: 'Live / Backtest',
                value: `${detailCombo.liveCount} / ${detailCombo.backtestCount}`,
                color: 'text-gray-300',
              },
              {
                label: 'Wins / Losses',
                value: `${detailCombo.winCount}W · ${detailCombo.lossCount}L`,
                color: 'text-gray-300',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-900/40 rounded-lg p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={cn('text-lg font-bold', color)}>{value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="bg-gray-900/40 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Unresolved trades</p>
              <p className="text-base font-bold text-gray-300">{detailCombo.unresolvedCount}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">
                Neither stop nor target was reached — scored at actual realized P&L
              </p>
            </div>
            <div className="bg-gray-900/40 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-1">Ambiguous trades</p>
              <p className="text-base font-bold text-amber-400">{detailCombo.ambiguousCount}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">
                MAE ≥ stop AND MFE ≥ target — hit order unknown; resolved conservatively as losses
              </p>
            </div>
          </div>
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
