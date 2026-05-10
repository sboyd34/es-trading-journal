'use client'

import { useState, useEffect, useCallback } from 'react'
import { Trade } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { parseTradovateCSV } from '@/lib/tradovate-parser'
import { formatCurrency, getMoodEmoji, getGradeColor, getPnLColor, cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import TradeAnnotationForm from '@/components/journal/TradeAnnotationForm'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { Upload, Filter } from 'lucide-react'

type Tab = 'log' | 'import'

export default function JournalPage() {
  const [tab, setTab] = useState<Tab>('log')
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [annotatingTrade, setAnnotatingTrade] = useState<Trade | null>(null)

  // Filters
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [filterDirection, setFilterDirection] = useState<'all' | 'long' | 'short'>('all')
  const [filterGrade, setFilterGrade] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [filterMood, setFilterMood] = useState<string>('all')

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

  const filteredTrades = trades.filter((t) => {
    if (filterDateFrom && t.date < filterDateFrom) return false
    if (filterDateTo && t.date > filterDateTo) return false
    if (filterDirection !== 'all' && t.direction !== filterDirection) return false
    if (filterGrade !== 'all' && t.grade !== filterGrade) return false
    if (filterMood !== 'all' && t.mood !== filterMood) return false
    return true
  })

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
            {(filterDateFrom || filterDateTo || filterDirection !== 'all' || filterGrade !== 'all' || filterMood !== 'all') && (
              <button
                onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterDirection('all'); setFilterGrade('all'); setFilterMood('all') }}
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
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Time</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Dir</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Qty</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Entry</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Exit</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">P&L</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Mood</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Grade</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Setup</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((trade, i) => (
                      <tr
                        key={trade.id}
                        className={cn(
                          'border-b border-gray-700/30 hover:bg-gray-700/20 transition',
                          i % 2 === 0 ? 'bg-transparent' : 'bg-gray-800/20'
                        )}
                      >
                        <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                          {format(parseISO(trade.date), 'MM/dd/yy')}
                        </td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                          {format(parseISO(trade.entry_time), 'HH:mm')}
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
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-[100px] truncate">
                          {trade.setup_tag || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setAnnotatingTrade(trade)}
                            className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 rounded px-2 py-1 transition"
                          >
                            Annotate
                          </button>
                        </td>
                      </tr>
                    ))}
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

      {/* Annotate Modal */}
      <Modal
        open={!!annotatingTrade}
        onClose={() => setAnnotatingTrade(null)}
        title={`Annotate Trade — ${annotatingTrade ? format(parseISO(annotatingTrade.date), 'MMM d, yyyy') : ''}`}
        className="max-w-xl"
      >
        {annotatingTrade && (
          <TradeAnnotationForm
            trade={annotatingTrade}
            onClose={() => setAnnotatingTrade(null)}
            onSaved={handleTradeSaved}
          />
        )}
      </Modal>
    </div>
  )
}
