'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { BlindBacktestTrade } from '@/types'
import { cn, formatCurrency } from '@/lib/utils'
import { RefreshCw, AlertCircle, Trophy, TrendingDown, Minus, Brain, Camera } from 'lucide-react'
import type { Candle } from './CandlestickChart'
import ImageUploadSlot from '@/components/ui/ImageUploadSlot'
import IndicatorToggleBar, { useIndicatorPrefs } from '@/components/charts/IndicatorToggleBar'

const CandlestickChart = dynamic(() => import('./CandlestickChart'), { ssr: false })
const CHART_BUCKET = 'trade-charts'

interface Props {
  trade: BlindBacktestTrade | null
  open: boolean
  onClose: () => void
  onUpdated?: (trade: BlindBacktestTrade) => void
}

interface ChartResp {
  blindCandles: Candle[]
  fullCandles: Candle[]
  cutoffIndex: number
  cutoffTimeCT: string
  historicalDate: string
  ticker: string
}

function gradeBg(g: string | null) {
  if (g === 'A') return 'bg-emerald-500/10 text-emerald-400'
  if (g === 'B') return 'bg-yellow-500/10 text-yellow-400'
  if (g === 'C') return 'bg-red-500/10 text-red-400'
  return 'bg-gray-700/50 text-gray-500'
}

export default function TradeReplayModal({ trade, open, onClose, onUpdated }: Props) {
  const [chart, setChart] = useState<ChartResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBlind, setShowBlind] = useState(false)
  const [chartUrl, setChartUrl] = useState<string | null>(null)
  const [uploadingChart, setUploadingChart] = useState(false)
  const [indicatorPrefs, setIndicatorPrefs] = useIndicatorPrefs('blindBacktestIndicators')

  useEffect(() => {
    if (!open || !trade) return
    setChart(null)
    setError(null)
    setShowBlind(false)
    setChartUrl(trade.chart_url ?? null)
    setLoading(true)
    const params = new URLSearchParams({
      date: trade.historical_date,
      cutoff: trade.chart_cutoff_time,
    })
    fetch(`/api/blind-backtest/chart?${params}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? 'Failed to load chart')
        setChart(data)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load chart'))
      .finally(() => setLoading(false))
  }, [open, trade])

  async function persistChartUrl(nextUrl: string | null) {
    if (!trade) return
    try {
      const res = await fetch(`/api/blind-backtest/trades/${trade.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart_url: nextUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to update trade')
      if (data.trade && onUpdated) onUpdated(data.trade as BlindBacktestTrade)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save chart URL')
    }
  }

  async function handleUploadChart(file: File) {
    if (!trade) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10 MB')
      return
    }
    setUploadingChart(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error('Not signed in')
        return
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/blind/${trade.id}/chart.${ext}`
      const { error: upErr } = await supabase.storage
        .from(CHART_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from(CHART_BUCKET).getPublicUrl(path)
      const bustedUrl = `${data.publicUrl}?t=${Date.now()}`
      setChartUrl(bustedUrl)
      await persistChartUrl(bustedUrl.split('?')[0])
      toast.success('Chart uploaded')
    } catch (err) {
      toast.error('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setUploadingChart(false)
    }
  }

  async function handleRemoveChart() {
    if (!chartUrl) return
    const supabase = createClient()
    const storagePath = chartUrl.split(`/${CHART_BUCKET}/`)[1]?.split('?')[0]
    if (storagePath) {
      await supabase.storage.from(CHART_BUCKET).remove([storagePath])
    }
    setChartUrl(null)
    await persistChartUrl(null)
    toast.success('Chart removed')
  }

  const excursion = useMemo(() => {
    if (!trade) return null
    if (trade.mfe != null && trade.mae != null) {
      return { mfe: trade.mfe, mae: trade.mae }
    }
    if (!chart) return null
    // Fallback for trades saved before MFE/MAE was tracked: replay the bars.
    const afterCutoff = chart.fullCandles.slice(chart.cutoffIndex + 1)
    const { entry_price: entry, stop_price: stop, target_price: target, direction } = trade
    let mfe = 0, mae = 0
    for (const c of afterCutoff) {
      if (direction === 'long') {
        mfe = Math.max(mfe, c.h - entry)
        mae = Math.max(mae, entry - c.l)
        if (c.l <= stop || c.h >= target) break
      } else {
        mfe = Math.max(mfe, entry - c.l)
        mae = Math.max(mae, c.h - entry)
        if (c.h >= stop || c.l <= target) break
      }
    }
    return { mfe, mae }
  }, [trade, chart])

  if (!trade) return null

  const cutoffCandle = chart?.blindCandles[chart.blindCandles.length - 1]
  const displayCandles = showBlind ? (chart?.blindCandles ?? []) : (chart?.fullCandles ?? [])
  const stopDist = Math.abs(trade.entry_price - trade.stop_price)
  const mfeR = excursion && stopDist > 0 ? excursion.mfe / stopDist : null
  const maeR = excursion && stopDist > 0 ? excursion.mae / stopDist : null

  return (
    <Modal open={open} onClose={onClose} title="Trade Replay" className="max-w-4xl">
      <div className="p-5 space-y-4">
        {/* Header: outcome + date + setup */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {trade.outcome === 'WIN'  && <Trophy className="h-6 w-6 text-emerald-400" />}
            {trade.outcome === 'LOSS' && <TrendingDown className="h-6 w-6 text-red-400" />}
            {trade.outcome === 'SCRATCH' && <Minus className="h-6 w-6 text-gray-400" />}
            <div>
              <p className={cn('text-xl font-black',
                trade.outcome === 'WIN' ? 'text-emerald-400' :
                trade.outcome === 'LOSS' ? 'text-red-400' : 'text-gray-300')}>
                {trade.outcome}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(trade.historical_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                {' · '}cutoff {trade.chart_cutoff_time} CT
                {' · '}{trade.trade_setup ?? '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {trade.gross_pnl != null && (
              <div className="text-right">
                <p className="text-xs text-gray-500">P&L</p>
                <p className={cn('font-bold', trade.gross_pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {formatCurrency(trade.gross_pnl)}
                </p>
              </div>
            )}
            {trade.r_multiple != null && (
              <div className="text-right">
                <p className="text-xs text-gray-500">R</p>
                <p className={cn('font-bold', trade.r_multiple >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {trade.r_multiple > 0 ? '+' : ''}{trade.r_multiple.toFixed(2)}R
                </p>
              </div>
            )}
            {mfeR != null && (
              <div className="text-right">
                <p className="text-xs text-gray-500">MFE</p>
                <p className="font-bold text-emerald-400">+{mfeR.toFixed(2)}R</p>
              </div>
            )}
            {maeR != null && (
              <div className="text-right">
                <p className="text-xs text-gray-500">MAE</p>
                <p className="font-bold text-red-400">−{maeR.toFixed(2)}R</p>
              </div>
            )}
            {trade.ai_grade && (
              <span className={cn('px-2 py-1 rounded text-sm font-bold', gradeBg(trade.ai_grade))}>
                {trade.ai_grade}
              </span>
            )}
          </div>
        </div>

        {/* Blind/Full toggle */}
        {chart && (
          <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1 w-fit">
            <button onClick={() => setShowBlind(true)}
              className={cn('px-3 py-1 rounded text-xs font-medium transition',
                showBlind ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
              Blind view (at cutoff)
            </button>
            <button onClick={() => setShowBlind(false)}
              className={cn('px-3 py-1 rounded text-xs font-medium transition',
                !showBlind ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
              Full view (with outcome)
            </button>
          </div>
        )}

        {/* Chart */}
        {loading && (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl flex items-center justify-center h-[380px]">
            <div className="text-center">
              <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-400">Loading chart…</p>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}
        {chart && !loading && (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3 space-y-2">
            <IndicatorToggleBar value={indicatorPrefs} onChange={setIndicatorPrefs} />
            <CandlestickChart
              candles={displayCandles}
              entryPrice={trade.entry_price}
              stopPrice={trade.stop_price}
              targetPrice={trade.target_price}
              cutoffTimestamp={showBlind ? undefined : cutoffCandle?.t}
              direction={trade.direction as 'long' | 'short'}
              indicators={indicatorPrefs}
              height={380}
            />
          </div>
        )}

        {/* Your annotated chart */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Camera className="h-3.5 w-3.5 text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Your Annotated Chart</h3>
          </div>
          <ImageUploadSlot
            label=""
            currentUrl={chartUrl}
            uploading={uploadingChart}
            onFile={handleUploadChart}
            onClear={handleRemoveChart}
            heightClass="h-48"
          />
        </div>

        {/* Plan summary */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Trade Plan</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              ['Bias',      trade.trade_bias ?? '—'],
              ['Setup',     trade.trade_setup ?? '—'],
              ['Direction', trade.direction === 'long' ? '▲ Long' : '▼ Short'],
              ['Confidence', trade.confidence != null ? `${trade.confidence}/5` : '—'],
              ['Entry',  trade.entry_price.toFixed(2)],
              ['Stop',   trade.stop_price.toFixed(2)],
              ['Target', trade.target_price.toFixed(2)],
              ['Mood',   trade.mood ?? '—'],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-gray-500">{label}</p>
                <p className="text-gray-200 font-medium capitalize">{val}</p>
              </div>
            ))}
            {trade.trade_trigger && (
              <div className="sm:col-span-4">
                <p className="text-gray-500">Trigger</p>
                <p className="text-gray-200">{trade.trade_trigger}</p>
              </div>
            )}
            {trade.trade_location && (
              <div className="sm:col-span-4">
                <p className="text-gray-500">Location</p>
                <p className="text-gray-200">{trade.trade_location}</p>
              </div>
            )}
            {trade.trade_risk && (
              <div className="sm:col-span-4">
                <p className="text-gray-500">Risk</p>
                <p className="text-gray-200">{trade.trade_risk}</p>
              </div>
            )}
          </div>
        </div>

        {/* AI feedback */}
        {trade.ai_feedback && (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="h-4 w-4 text-blue-400" />
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AI Feedback</h3>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed">{trade.ai_feedback}</p>
          </div>
        )}

        {/* Reflection */}
        {(trade.notes || trade.reflection) && (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reflection</h3>
            {trade.notes && (
              <div>
                <p className="text-xs text-gray-500 mb-1">What you saw</p>
                <p className="text-sm text-gray-300">{trade.notes}</p>
              </div>
            )}
            {trade.reflection && (
              <div>
                <p className="text-xs text-gray-500 mb-1">What you&apos;d do differently</p>
                <p className="text-sm text-gray-300">{trade.reflection}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
