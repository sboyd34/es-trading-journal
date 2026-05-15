'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { MarketState } from '@/app/api/market-state/route'
import { Activity, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react'

interface Props {
  className?: string
  onUseLevels?: (text: string) => void  // when provided, shows a "Use in brief" button
}

const STATUS_COPY: Record<MarketState['sessionStatus'], { label: string; color: string }> = {
  'pre-open':       { label: 'Pre-market',     color: 'text-blue-400' },
  'opening-range':  { label: 'Opening range',  color: 'text-amber-400' },
  'in-session':     { label: 'In session',     color: 'text-emerald-400' },
  'after-hours':    { label: 'After hours',    color: 'text-gray-400' },
  'no-data':        { label: 'No data',        color: 'text-gray-500' },
}

function formatPrice(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(2)
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function buildBriefText(s: MarketState): string {
  const parts: string[] = []
  parts.push(`${s.ticker} reference levels (auto-pulled):`)
  if (s.prevDay) {
    parts.push(`- PDH ${formatPrice(s.prevDay.high)} · PDL ${formatPrice(s.prevDay.low)} · prev close ${formatPrice(s.prevDay.close)}`)
  }
  if (s.today) {
    if (s.today.gapPct != null) {
      parts.push(`- Gap: ${formatPct(s.today.gapPct)} vs prev close (last ${formatPrice(s.today.lastTrade)})`)
    }
    if (s.today.sessionOpen != null) {
      parts.push(`- Today's open: ${formatPrice(s.today.sessionOpen)}`)
    }
    if (s.today.openingRange) {
      parts.push(`- Opening range (first 30m): ORH ${formatPrice(s.today.openingRange.high)} · ORL ${formatPrice(s.today.openingRange.low)}`)
    }
    if (s.today.high != null && s.today.low != null) {
      parts.push(`- Session range so far: high ${formatPrice(s.today.high)} · low ${formatPrice(s.today.low)}`)
    }
  }
  return parts.join('\n')
}

export default function MarketStateCard({ className, onUseLevels }: Props) {
  const [state, setState] = useState<MarketState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch('/api/market-state')
      .then(async (r) => {
        const data = await r.json()
        if (cancelled) return
        if (!r.ok) setError(data.error ?? 'Failed to load market state')
        else setState(data as MarketState)
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className={cn('bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-center gap-3', className)}>
        <RefreshCw className="h-4 w-4 text-blue-400 animate-spin" />
        <span className="text-sm text-gray-400">Loading market state…</span>
      </div>
    )
  }
  if (error || !state) {
    return (
      <div className={cn('bg-gray-800/30 border border-gray-700/30 rounded-xl p-4 text-sm text-gray-500', className)}>
        {error ?? 'Market state unavailable'}
      </div>
    )
  }

  const status = STATUS_COPY[state.sessionStatus]
  const gapPositive = state.today?.gapPct != null && state.today.gapPct >= 0

  return (
    <div className={cn('bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden', className)}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/40">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-200">{state.ticker} Market State</span>
          <span className="text-[10px] text-gray-600 ml-1">proxy for ES futures</span>
        </div>
        <span className={cn('text-[11px] font-medium uppercase tracking-wider', status.color)}>{status.label}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-gray-700/30">
        {/* Yesterday */}
        <div className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Yesterday</p>
          {state.prevDay ? (
            <div className="space-y-0.5 text-xs">
              <p className="text-gray-300">High <span className="text-white font-medium font-mono">{formatPrice(state.prevDay.high)}</span></p>
              <p className="text-gray-300">Low  <span className="text-white font-medium font-mono">{formatPrice(state.prevDay.low)}</span></p>
              <p className="text-gray-300">Close <span className="text-white font-medium font-mono">{formatPrice(state.prevDay.close)}</span></p>
            </div>
          ) : <p className="text-xs text-gray-600">—</p>}
        </div>

        {/* Gap */}
        <div className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Gap</p>
          {state.today?.gapPct != null ? (
            <div className="flex items-center gap-1.5">
              {gapPositive ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : <TrendingDown className="h-3.5 w-3.5 text-red-400" />}
              <span className={cn('text-lg font-bold', gapPositive ? 'text-emerald-400' : 'text-red-400')}>
                {formatPct(state.today.gapPct)}
              </span>
            </div>
          ) : <p className="text-xs text-gray-600">—</p>}
          {state.today?.lastTrade != null && (
            <p className="text-[11px] text-gray-500 mt-1">Last <span className="font-mono">{formatPrice(state.today.lastTrade)}</span></p>
          )}
        </div>

        {/* Opening range */}
        <div className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Opening Range</p>
          {state.today?.openingRange ? (
            <div className="space-y-0.5 text-xs">
              <p className="text-gray-300">ORH <span className="text-white font-medium font-mono">{formatPrice(state.today.openingRange.high)}</span></p>
              <p className="text-gray-300">ORL <span className="text-white font-medium font-mono">{formatPrice(state.today.openingRange.low)}</span></p>
              {state.today.openingRange.high - state.today.openingRange.low > 0 && (
                <p className="text-[11px] text-gray-500">
                  Width <span className="font-mono">{formatPrice(state.today.openingRange.high - state.today.openingRange.low)}</span>
                </p>
              )}
            </div>
          ) : <p className="text-xs text-gray-600">pending</p>}
        </div>

        {/* Session range */}
        <div className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Session So Far</p>
          {state.today?.high != null && state.today?.low != null ? (
            <div className="space-y-0.5 text-xs">
              <p className="text-gray-300">High <span className="text-white font-medium font-mono">{formatPrice(state.today.high)}</span></p>
              <p className="text-gray-300">Low <span className="text-white font-medium font-mono">{formatPrice(state.today.low)}</span></p>
              {state.today.sessionOpen != null && (
                <p className="text-gray-300">Open <span className="text-white font-medium font-mono">{formatPrice(state.today.sessionOpen)}</span></p>
              )}
            </div>
          ) : <p className="text-xs text-gray-600">—</p>}
        </div>
      </div>

      {onUseLevels && (
        <div className="px-4 py-2 border-t border-gray-700/40">
          <button
            onClick={() => onUseLevels(buildBriefText(state))}
            className="text-xs font-medium text-blue-400 hover:text-blue-300 transition"
          >
            Append these levels to your brief →
          </button>
        </div>
      )}
    </div>
  )
}
