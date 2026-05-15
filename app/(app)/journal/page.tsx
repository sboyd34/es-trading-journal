'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Trade } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { parseTradovateCSV } from '@/lib/tradovate-parser'
import { formatCurrency, getMoodEmoji, getGradeColor, getPnLColor, cn } from '@/lib/utils'
import { computeTradeFlags, classifyWindow, ctTimeLabel } from '@/lib/trade-flags'
import { Modal } from '@/components/ui/Modal'
import TradeAnnotationForm from '@/components/journal/TradeAnnotationForm'
import FiveWordGateModal, { GateAnswers } from '@/components/journal/FiveWordGateModal'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { Upload, Filter, Camera, ExternalLink, ChevronLeft, ChevronRight, AlertTriangle, LineChart, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import type { TradeChartResponse } from '@/app/api/trades/[id]/chart/route'
import IndicatorToggleBar, { useIndicatorPrefs } from '@/components/charts/IndicatorToggleBar'
import TradeNarrativePanel from '@/components/journal/TradeNarrativePanel'

const CandlestickChart = dynamic(
  () => import('@/components/blind-backtest/CandlestickChart'),
  { ssr: false },
)

type Tab = 'log' | 'import'

export default function JournalPage() {
  const [tab, setTab] = useState<Tab>('log')
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [checklistTrade, setChecklistTrade] = useState<Trade | null>(null)
  const [annotatingTrade, setAnnotatingTrade] = useState<Trade | null>(null)
  const [gateAnswers, setGateAnswers] = useState<GateAnswers | null>(null)
  const [isRevengeFlagged, setIsRevengeFlagged] = useState(false)
  const [lightboxTrade, setLightboxTrade] = useState<Trade | null>(null)
  const [lightboxTab, setLightboxTab] = useState<'entry' | 'exit' | 'auto' | 'narrative'>('auto')

  // Auto chart (polygon-backed proxy chart for the active lightbox trade)
  const [autoChart, setAutoChart] = useState<TradeChartResponse | null>(null)
  const [autoChartLoading, setAutoChartLoading] = useState(false)
  const [autoChartError, setAutoChartError] = useState<string | null>(null)
  const [journalIndicatorPrefs, setJournalIndicatorPrefs] = useIndicatorPrefs('journalAutoChartIndicators')

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterDirection, setFilterDirection] = useState<'all' | 'long' | 'short'>('all')
  const [filterGrade, setFilterGrade] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [filterMood, setFilterMood] = useState<string>('all')
  const [filterInstrument, setFilterInstrument] = useState<string>('all')

  // Import state
  const [parsedTrades, setParsedTrades] = useState<ReturnType<typeof parseTradovateCSV>>([])
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const supabase = createClient()

  const loadTrades = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('entry_time', { ascending: false })

    setTrades((data as Trade[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadTrades()
  }, [loadTrades])

  // When the lightbox opens, pick a sensible default tab and prefetch the
  // proxy chart so the Auto tab is ready when the user switches to it.
  useEffect(() => {
    if (!lightboxTrade) {
      setAutoChart(null)
      setAutoChartError(null)
      setAutoChartLoading(false)
      return
    }
    const hasEntry = !!lightboxTrade.entry_chart_url
    const hasExit  = !!lightboxTrade.exit_chart_url
    setLightboxTab(hasEntry ? 'entry' : hasExit ? 'exit' : 'auto')

    let cancelled = false
    setAutoChart(null)
    setAutoChartError(null)
    setAutoChartLoading(true)
    fetch(`/api/trades/${lightboxTrade.id}/chart`)
      .then(async (r) => {
        const data = await r.json()
        if (cancelled) return
        if (!r.ok) {
          setAutoChartError(data.error ?? 'Failed to load chart')
        } else {
          setAutoChart(data as TradeChartResponse)
        }
      })
      .catch((e) => {
        if (!cancelled) setAutoChartError(e instanceof Error ? e.message : 'Failed to load chart')
      })
      .finally(() => { if (!cancelled) setAutoChartLoading(false) })
    return () => { cancelled = true }
  }, [lightboxTrade])

  const filteredTrades = trades.filter((t) => {
    if (filterDateFrom && t.date < filterDateFrom) return false
    if (filterDateTo && t.date > filterDateTo) return false
    if (filterDirection !== 'all' && t.direction !== filterDirection) return false
    if (filterGrade !== 'all' && t.grade !== filterGrade) return false
    if (filterMood !== 'all' && t.mood !== filterMood) return false
    if (filterInstrument !== 'all' && (t.instrument || 'ES') !== filterInstrument) return false
    return true
  })

  // Precompute rule flags for every trade (deterministic, no API call).
  const flagMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeTradeFlags>>()
    for (const t of filteredTrades) {
      const flags = computeTradeFlags(t, trades)
      if (flags.length > 0) map.set(t.id, flags)
    }
    return map
  }, [filteredTrades, trades])

  function handleCSVFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      try {
        const parsed = parseTradovateCSV(text)
        setParsedTrades(parsed)
        if (parsed.length === 0) {
          toast.error('No trades found in CSV. Check the format.')
        } else {
          toast.success(`Found ${parsed.length} trades`)
        }
      } catch (err) {
        toast.error('Failed to parse CSV: ' + (err instanceof Error ? err.message : 'Unknown error'))
      }
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) {
      handleCSVFile(file)
    } else {
      toast.error('Please drop a CSV file')
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleCSVFile(file)
  }

  async function handleImportAll() {
    if (!parsedTrades.length) return
    setImporting(true)
    try {
      const res = await fetch('/api/trades/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: parsedTrades }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Import failed')
      }
      const { inserted } = await res.json()
      toast.success(`Imported ${inserted} trades!`)
      setParsedTrades([])
      setTab('log')
      loadTrades()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  function handleTradeSaved(updatedTrade: Trade) {
    setTrades((prev) => prev.map((t) => t.id === updatedTrade.id ? updatedTrade : t))
    // Sync lightbox if it's showing the same trade
    if (lightboxTrade?.id === updatedTrade.id) setLightboxTrade(updatedTrade)
  }

  function openLightbox(trade: Trade, tab: 'entry' | 'exit') {
    setLightboxTrade(trade)
    setLightboxTab(tab)
  }

  function handleGateComplete(answers: GateAnswers) {
    setGateAnswers(answers)
    setAnnotatingTrade(checklistTrade)
    setChecklistTrade(null)
  }

  function handleAnnotateClose() {
    setAnnotatingTrade(null)
    setGateAnswers(null)
    setIsRevengeFlagged(false)
  }

  async function handleDeleteTrade(trade: Trade) {
    const ctTime = ctTimeLabel(trade.entry_time) ?? '??:??'
    const label = `${trade.direction.toUpperCase()} ${trade.quantity}x ${trade.instrument || 'ES'} on ${trade.date} at ${ctTime} CT (P&L ${trade.net_pnl >= 0 ? '+' : ''}$${trade.net_pnl.toFixed(2)})`
    if (!confirm(`Delete this trade?\n\n${label}\n\nThis cannot be undone.`)) return
    try {
      const res = await fetch(`/api/trades/${trade.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete')
      }
      setTrades((prev) => prev.filter((t) => t.id !== trade.id))
      if (lightboxTrade?.id === trade.id) setLightboxTrade(null)
      if (annotatingTrade?.id === trade.id) setAnnotatingTrade(null)
      toast.success('Trade deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Trade Journal</h1>
        <p className="text-sm text-gray-400 mt-1">{trades.length} total trades</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab('log')}
          className={cn(
            'px-5 py-2 rounded-lg text-sm font-medium transition',
            tab === 'log' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          )}
        >
          Trade Log
        </button>
        <button
          onClick={() => setTab('import')}
          className={cn(
            'px-5 py-2 rounded-lg text-sm font-medium transition',
            tab === 'import' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
          )}
        >
          Import CSV
        </button>
      </div>

      {/* Trade Log Tab */}
      {tab === 'log' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3 bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <span className="text-xs text-gray-400 font-medium">Filters:</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">From</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">To</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <select
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value as typeof filterDirection)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Directions</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
            <select
              value={filterGrade}
              onChange={(e) => setFilterGrade(e.target.value as typeof filterGrade)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Grades</option>
              <option value="A">Grade A</option>
              <option value="B">Grade B</option>
              <option value="C">Grade C</option>
            </select>
            <select
              value={filterMood}
              onChange={(e) => setFilterMood(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Moods</option>
              {['calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident'].map(m => (
                <option key={m} value={m}>{getMoodEmoji(m)} {m}</option>
              ))}
            </select>
            <select
              value={filterInstrument}
              onChange={(e) => setFilterInstrument(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Instruments</option>
              <option value="ES">ES</option>
              <option value="NQ">NQ</option>
              <option value="MES">MES</option>
              <option value="MNQ">MNQ</option>
            </select>
            {(filterDateFrom || filterDateTo || filterDirection !== 'all' || filterGrade !== 'all' || filterMood !== 'all' || filterInstrument !== 'all') && (
              <button
                onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterDirection('all'); setFilterGrade('all'); setFilterMood('all'); setFilterInstrument('all') }}
                className="text-xs text-blue-400 hover:text-blue-300 transition"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading trades...</div>
          ) : filteredTrades.length === 0 ? (
            <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700/50">
              <p className="text-gray-400 font-medium">No trades found</p>
              <p className="text-gray-600 text-sm mt-1">
                {trades.length === 0 ? 'Import your first trades from the Import CSV tab' : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Instr</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Time</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Dir</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Qty</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Entry</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Exit</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Gross</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Net</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Mood</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Grade</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Setup</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Charts</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((trade, i) => {
                      const flags = flagMap.get(trade.id) ?? []
                      const hasCritical = flags.some((f) => f.severity === 'critical')
                      const hasWarning = flags.some((f) => f.severity === 'warning')
                      const hasFlags = flags.length > 0

                      // Classify the entry window for time-cell coloring
                      const ctLabel = ctTimeLabel(trade.entry_time)
                      const ctMinsVal = ctLabel
                        ? (() => { const [h, m] = ctLabel.split(':').map(Number); return h * 60 + m })()
                        : null
                      const windowStatus = ctMinsVal !== null ? classifyWindow(ctMinsVal) : 'unknown'
                      const timeIsOk = windowStatus === 'primary' || windowStatus === 'continuation' || windowStatus === 'late' || windowStatus === 'secondary'

                      return (
                      <tr
                        key={trade.id}
                        className={cn(
                          'border-b border-gray-700/30 hover:bg-gray-700/20 transition',
                          i % 2 === 0 ? 'bg-transparent' : 'bg-gray-800/20',
                          hasCritical && 'bg-red-500/5',
                          hasWarning && !hasCritical && 'bg-amber-500/5',
                        )}
                      >
                        <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {hasFlags && (
                              <span
                                title={flags.map((f) => f.detail).join('\n')}
                                className={cn(
                                  'flex-shrink-0',
                                  hasCritical ? 'text-red-400' : 'text-amber-400',
                                )}
                              >
                                <AlertTriangle className="h-3 w-3" />
                              </span>
                            )}
                            {format(parseISO(trade.date), 'MM/dd/yy')}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-semibold text-blue-400/80">{trade.instrument || 'ES'}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs">
                          <span
                            className={cn(
                              timeIsOk ? 'text-gray-400' : 'text-red-400 font-semibold',
                            )}
                            title={!timeIsOk ? `Outside approved window — ${windowStatus.replace('_', ' ')}` : undefined}
                          >
                            {format(parseISO(trade.entry_time), 'HH:mm')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            'text-xs font-semibold px-1.5 py-0.5 rounded',
                            trade.direction === 'long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                          )}>
                            {trade.direction === 'long' ? 'L' : 'S'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300">{trade.quantity}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{trade.entry_price.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{trade.exit_price.toFixed(2)}</td>
                        <td className={cn('px-4 py-3 text-right text-xs', getPnLColor(trade.gross_pnl))}>
                          {formatCurrency(trade.gross_pnl)}
                        </td>
                        <td className={cn('px-4 py-3 text-right font-semibold', getPnLColor(trade.net_pnl))}>
                          {formatCurrency(trade.net_pnl)}
                        </td>
                        <td className="px-4 py-3 text-center text-lg">
                          {getMoodEmoji(trade.mood)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {trade.grade ? (
                            <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded', getGradeColor(trade.grade))}>
                              {trade.grade}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-[120px]">
                          <div className="flex items-center gap-1.5">
                            {trade.tags?.includes('news driven') && (
                              <span
                                className="h-2 w-2 rounded-full bg-amber-500 shrink-0 animate-pulse"
                                title="News-driven trade — high-impact headline within 15 min of entry"
                              />
                            )}
                            <span className="truncate">{trade.setup_tag || '—'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(trade.entry_chart_url || trade.exit_chart_url) ? (
                            <div className="flex items-center justify-center gap-1">
                              {trade.entry_chart_url && (
                                <button
                                  onClick={() => openLightbox(trade, 'entry')}
                                  title="Entry chart"
                                  className="group relative"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={trade.entry_chart_url}
                                    alt="Entry chart"
                                    className="h-7 w-11 object-cover rounded border border-gray-700 group-hover:border-blue-500/50 transition"
                                  />
                                </button>
                              )}
                              {trade.exit_chart_url && (
                                <button
                                  onClick={() => openLightbox(trade, 'exit')}
                                  title="Exit chart"
                                  className="group relative"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={trade.exit_chart_url}
                                    alt="Exit chart"
                                    className="h-7 w-11 object-cover rounded border border-gray-700 group-hover:border-blue-500/50 transition"
                                  />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-700 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => {
                                const THREE_MIN = 3 * 60 * 1000
                                const entryMs = new Date(trade.entry_time).getTime()
                                const revengeDetected = trades.some(t => {
                                  if (t.id === trade.id || t.net_pnl >= 0) return false
                                  const exitMs = new Date(t.exit_time).getTime()
                                  const gap = entryMs - exitMs
                                  return gap >= 0 && gap <= THREE_MIN
                                })
                                setIsRevengeFlagged(revengeDetected)
                                setChecklistTrade(trade)
                              }}
                              className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 rounded px-2 py-1 transition"
                            >
                              Annotate
                            </button>
                            <button
                              onClick={() => handleDeleteTrade(trade)}
                              title="Delete trade"
                              className="text-gray-500 hover:text-red-400 border border-transparent hover:border-red-500/40 rounded p-1 transition"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2 border-t border-gray-700/50 text-xs text-gray-500">
                Showing {filteredTrades.length} of {trades.length} trades
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import Tab */}
      {tab === 'import' && (
        <div className="space-y-5">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Import Tradovate CSV</h3>
            <p className="text-xs text-gray-400 mb-4">
              Export your fills from Tradovate (Account &rarr; Performance &rarr; Export) and drop the CSV file below.
            </p>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                'border-2 border-dashed rounded-xl p-10 text-center transition cursor-pointer',
                dragOver
                  ? 'border-blue-500 bg-blue-500/5'
                  : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/50'
              )}
              onClick={() => document.getElementById('csv-file-input')?.click()}
            >
              <Upload className="h-8 w-8 text-gray-500 mx-auto mb-3" />
              <p className="text-gray-300 font-medium">Drop your CSV file here</p>
              <p className="text-gray-500 text-sm mt-1">or click to browse</p>
              <input
                id="csv-file-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          </div>

          {/* Preview */}
          {parsedTrades.length > 0 && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-700/50 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-200">
                  Preview — {parsedTrades.length} trades found
                </h3>
                <button
                  onClick={handleImportAll}
                  disabled={importing}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
                >
                  {importing ? 'Saving...' : `Save All ${parsedTrades.length} Trades`}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Direction</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Qty</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Entry</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Exit</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Gross P&L</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Commission</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400">Net P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedTrades.map((trade, i) => (
                      <tr key={i} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                        <td className="px-4 py-2.5 text-gray-300 text-xs">{trade.date}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            'text-xs font-semibold',
                            trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400'
                          )}>
                            {trade.direction.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-300 text-xs">{trade.quantity}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-300">{trade.entry_price.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-300">{trade.exit_price.toFixed(2)}</td>
                        <td className={cn('px-4 py-2.5 text-right text-xs font-medium', getPnLColor(trade.gross_pnl))}>
                          {formatCurrency(trade.gross_pnl)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                          ({formatCurrency(trade.commission)})
                        </td>
                        <td className={cn('px-4 py-2.5 text-right text-xs font-bold', getPnLColor(trade.net_pnl))}>
                          {formatCurrency(trade.net_pnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-600">
                      <td colSpan={5} className="px-4 py-3 text-xs font-semibold text-gray-400">Total</td>
                      <td className={cn('px-4 py-3 text-right text-xs font-bold', getPnLColor(parsedTrades.reduce((s, t) => s + t.gross_pnl, 0)))}>
                        {formatCurrency(parsedTrades.reduce((s, t) => s + t.gross_pnl, 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-gray-500">
                        ({formatCurrency(parsedTrades.reduce((s, t) => s + t.commission, 0))})
                      </td>
                      <td className={cn('px-4 py-3 text-right text-xs font-bold', getPnLColor(parsedTrades.reduce((s, t) => s + t.net_pnl, 0)))}>
                        {formatCurrency(parsedTrades.reduce((s, t) => s + t.net_pnl, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Five-Word Gate modal */}
      <Modal
        open={!!checklistTrade}
        onClose={() => setChecklistTrade(null)}
        title="Bias · Setup · Trigger · Location · Risk"
        className="max-w-md"
      >
        {checklistTrade && (
          <FiveWordGateModal
            trade={checklistTrade}
            trades={trades}
            onComplete={handleGateComplete}
            onCancel={() => setChecklistTrade(null)}
          />
        )}
      </Modal>

      {/* Annotate Modal */}
      <Modal
        open={!!annotatingTrade}
        onClose={handleAnnotateClose}
        title={`Annotate Trade — ${annotatingTrade ? format(parseISO(annotatingTrade.date), 'MMM d, yyyy') : ''}`}
        className="max-w-xl"
      >
        {annotatingTrade && (
          <TradeAnnotationForm
            trade={annotatingTrade}
            onClose={handleAnnotateClose}
            onSaved={handleTradeSaved}
            initialInPlan={gateAnswers?.inPlan}
            isRevengeTrade={isRevengeFlagged}
            gateAnswers={gateAnswers ?? undefined}
          />
        )}
      </Modal>

      {/* Chart Lightbox */}
      <Modal
        open={!!lightboxTrade}
        onClose={() => setLightboxTrade(null)}
        title="Trade Charts"
        className="max-w-4xl"
      >
        {lightboxTrade && (() => {
          const hasEntry = !!lightboxTrade.entry_chart_url
          const hasExit  = !!lightboxTrade.exit_chart_url
          const activeUrl =
            lightboxTab === 'entry' ? lightboxTrade.entry_chart_url :
            lightboxTab === 'exit'  ? lightboxTrade.exit_chart_url  : null

          const TabButton = ({ tab, label, icon }: { tab: 'entry' | 'exit' | 'auto' | 'narrative'; label: string; icon: React.ReactNode }) => (
            <button
              onClick={() => setLightboxTab(tab)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition',
                lightboxTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white',
              )}
            >
              {icon}
              {label}
            </button>
          )

          return (
            <div className="space-y-4">
              {/* Tabs */}
              <div className="flex gap-2">
                {hasEntry && <TabButton tab="entry" label="Entry Chart" icon={<Camera className="h-3.5 w-3.5" />} />}
                {hasExit  && <TabButton tab="exit"  label="Exit Chart"  icon={<Camera className="h-3.5 w-3.5" />} />}
                <TabButton tab="auto" label="Auto Chart" icon={<LineChart className="h-3.5 w-3.5" />} />
                <TabButton tab="narrative" label="Narrative" icon={<Sparkles className="h-3.5 w-3.5" />} />
              </div>

              {/* Body */}
              {lightboxTab === 'narrative' ? (
                <TradeNarrativePanel
                  trade={lightboxTrade}
                  onUpdated={(t) => {
                    setLightboxTrade(t)
                    setTrades((prev) => prev.map((x) => (x.id === t.id ? t : x)))
                  }}
                />
              ) : lightboxTab === 'auto' ? (
                <div className="space-y-2">
                  {autoChartLoading && (
                    <div className="bg-gray-900/40 border border-gray-700/40 rounded-xl flex items-center justify-center h-[420px]">
                      <div className="text-center">
                        <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto mb-2" />
                        <p className="text-sm text-gray-400">Loading proxy chart…</p>
                      </div>
                    </div>
                  )}
                  {autoChartError && !autoChartLoading && (
                    <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-5 flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-red-300">{autoChartError}</p>
                    </div>
                  )}
                  {autoChart && !autoChartLoading && (
                    <>
                      <div className="bg-gray-900/40 border border-gray-700/40 rounded-xl p-3 space-y-2">
                        <IndicatorToggleBar value={journalIndicatorPrefs} onChange={setJournalIndicatorPrefs} />
                        <CandlestickChart
                          candles={autoChart.candles}
                          entryPrice={autoChart.entryPrice}
                          exitPrice={autoChart.exitPrice}
                          stopPrice={autoChart.stopProxyPrice ?? undefined}
                          targetPrice={autoChart.targetProxyPrice ?? undefined}
                          entryTimestamp={autoChart.entryTimestamp}
                          exitTimestamp={autoChart.exitTimestamp}
                          direction={autoChart.direction}
                          indicators={journalIndicatorPrefs}
                          height={420}
                        />
                      </div>
                      <p className="text-[11px] text-gray-500">
                        {autoChart.ticker} {autoChart.interval.multiplier}-{autoChart.interval.timespan} ·{' '}
                        {autoChart.proxyNote}. Stop/Target lines are scaled to the proxy via the entry-bar ratio.
                      </p>
                    </>
                  )}
                </div>
              ) : activeUrl ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeUrl}
                    alt={lightboxTab === 'entry' ? 'Entry chart' : 'Exit chart'}
                    className="w-full rounded-xl border border-gray-700/50 max-h-[70vh] object-contain bg-gray-950"
                  />
                  {hasEntry && hasExit && (
                    <>
                      <button
                        onClick={() => setLightboxTab(lightboxTab === 'entry' ? 'exit' : 'entry')}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-gray-900/80 text-gray-400 hover:text-white transition"
                        title="Previous"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        onClick={() => setLightboxTab(lightboxTab === 'entry' ? 'exit' : 'entry')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-gray-900/80 text-gray-400 hover:text-white transition"
                        title="Next"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
                  No {lightboxTab} chart uploaded yet
                </div>
              )}

              {/* Footer: label + open-in-new-tab */}
              {lightboxTab !== 'narrative' && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    {lightboxTab === 'entry' ? 'Entry chart' :
                     lightboxTab === 'exit'  ? 'Exit chart'  :
                     `Auto chart from polygon.io`}
                  </p>
                  {activeUrl && (
                    <a
                      href={activeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open full size
                    </a>
                  )}
                </div>
              )}
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
