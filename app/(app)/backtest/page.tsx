'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { BacktestSession, BacktestTrade, Trade } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import FiveWordGateModal, { GateAnswers } from '@/components/journal/FiveWordGateModal'
import BacktestTradeForm from '@/components/backtest/BacktestTradeForm'
import BlindBacktestClient from '@/components/blind-backtest/BlindBacktestClient'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { Plus, Trash2, Edit2, Brain, TrendingUp, TrendingDown } from 'lucide-react'
import { SYSTEM_SETUPS } from '@/lib/trading-system'

const POINT_VALUES: Record<string, number> = { ES: 50, MES: 5, NQ: 20, MNQ: 2 }

type TopTab = 'blind' | 'manual'

function getWindowLabel(timeStr: string | null): string {
  if (!timeStr) return 'Unknown'
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m
  if (total < 510) return 'Pre-market'
  if (total < 525) return '08:30–08:45'
  if (total < 570) return '08:45–09:30 ORB'
  if (total < 630) return '09:30–10:30'
  if (total < 660) return '10:30–11:00'
  if (total < 750) return '11:00–12:30 Dead Zone'
  if (total < 840) return '12:30–14:00 Secondary'
  return '14:00+ Closed'
}

function computeStats(trades: BacktestTrade[]) {
  const total = trades.length
  const winners = trades.filter((t) => t.net_pnl > 0)
  const losers = trades.filter((t) => t.net_pnl < 0)
  const winRate = total ? (winners.length / total) * 100 : 0
  const totalPnL = trades.reduce((s, t) => s + t.net_pnl, 0)
  const grossWins = winners.reduce((s, t) => s + t.net_pnl, 0)
  const grossLosses = Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0))
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0

  const rValues = trades
    .map((t) => {
      if (!t.stop_loss) return null
      const pv = POINT_VALUES[t.instrument] ?? 50
      const risk = Math.abs(t.entry_price - t.stop_loss) * pv * t.quantity
      return risk > 0 ? t.net_pnl / risk : null
    })
    .filter((r): r is number => r !== null)
  const avgR = rValues.length ? rValues.reduce((s, r) => s + r, 0) / rValues.length : null

  return { total, winRate, totalPnL, profitFactor, avgR, winners: winners.length, losers: losers.length }
}

// ── Edge-decay scoring ────────────────────────────────────────────────────────
// Measures how well a setup's *backtested* edge survives in *live* trading.
// The verdict's tone drives the badge color in the scorecard UI.

type EdgeTone = 'good' | 'warn' | 'bad' | 'neutral'

interface EdgeVerdict {
  label: string
  tone: EdgeTone
}

const EDGE_TONE_CLASSES: Record<EdgeTone, string> = {
  good: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  warn: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  bad: 'bg-red-500/10 text-red-400 border-red-500/30',
  neutral: 'bg-gray-700/40 text-gray-400 border-gray-600/40',
}

/**
 * Turn a setup's decay numbers into a plain-language verdict.
 *
 *   winRateDecay   = live win%  − backtest win%   (negative = worse live)
 *   avgPnLDecay    = live avg$   − backtest avg$    (negative = worse live)
 *   liveAvgPnL     = live average $ per trade
 *   backtestAvgPnL = backtest average $ per trade
 *   sampleSize     = min(backtest count, live count) — your confidence floor
 *
 * Cutoffs lean tight (−5 / −12) on purpose: Apex drawdowns are unforgiving, so a
 * false alarm costs nothing but a missed collapse costs the account. Raise the
 * sample floor as live history grows to make verdicts more trustworthy.
 */
function classifyEdge(input: {
  winRateDecay: number
  avgPnLDecay: number
  liveAvgPnL: number
  backtestAvgPnL: number
  sampleSize: number
}): EdgeVerdict {
  const { winRateDecay, liveAvgPnL, backtestAvgPnL, sampleSize } = input
  if (sampleSize < 5) return { label: 'Building sample', tone: 'neutral' }
  if (winRateDecay >= -5 && liveAvgPnL < 0 && backtestAvgPnL > 0)
    return { label: 'Profit leak', tone: 'bad' }
  if (winRateDecay >= 5) return { label: 'Stronger live', tone: 'good' }
  if (winRateDecay >= -5) return { label: 'Edge holds', tone: 'good' }
  if (winRateDecay >= -12) return { label: 'Edge slipping', tone: 'warn' }
  return { label: 'Edge collapsing', tone: 'bad' }
}

type PageTab = 'session' | 'analytics' | 'comparison'

export default function BacktestPage() {
  const today = format(new Date(), 'yyyy-MM-dd')

  const [topTab, setTopTab] = useState<TopTab>('blind')
  const [selectedDate, setSelectedDate] = useState(today)
  const [session, setSession] = useState<BacktestSession | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [trades, setTrades] = useState<BacktestTrade[]>([])
  const [tradesLoading, setTradesLoading] = useState(false)
  const [liveTrades, setLiveTrades] = useState<Trade[]>([])
  const [tab, setTab] = useState<PageTab>('session')

  // Session form
  const [onh, setOnh] = useState('')
  const [onl, setOnl] = useState('')
  const [pdh, setPdh] = useState('')
  const [pdl, setPdl] = useState('')
  const [vwap, setVwap] = useState('')
  const [bias, setBias] = useState<'Bull' | 'Bear' | 'Neutral' | ''>('')
  const [dayNotes, setDayNotes] = useState('')
  const [savingSession, setSavingSession] = useState(false)

  // Modals
  const [gateOpen, setGateOpen] = useState(false)
  const [gateAnswers, setGateAnswers] = useState<GateAnswers | null>(null)
  const [tradeFormOpen, setTradeFormOpen] = useState(false)
  const [editingTrade, setEditingTrade] = useState<BacktestTrade | null>(null)
  const [editGateAnswers, setEditGateAnswers] = useState<GateAnswers | null>(null)
  const [editGateOpen, setEditGateOpen] = useState(false)

  // AI
  const [aiSummary, setAiSummary] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const supabase = createClient()

  const loadSession = useCallback(async (date: string) => {
    setSessionLoading(true)
    setTradesLoading(true)
    try {
      const [sessionRes, tradesRes] = await Promise.all([
        fetch(`/api/backtest/sessions?date=${date}`),
        fetch(`/api/backtest/trades?date=${date}`),
      ])
      const sessionData = await sessionRes.json()
      const tradesData = await tradesRes.json()

      const s: BacktestSession | null = sessionData.session
      setSession(s)
      if (s) {
        setOnh(s.onh?.toString() ?? '')
        setOnl(s.onl?.toString() ?? '')
        setPdh(s.pdh?.toString() ?? '')
        setPdl(s.pdl?.toString() ?? '')
        setVwap(s.vwap?.toString() ?? '')
        setBias((s.bias as 'Bull' | 'Bear' | 'Neutral' | '') ?? '')
        setDayNotes(s.notes ?? '')
      } else {
        setOnh(''); setOnl(''); setPdh(''); setPdl(''); setVwap(''); setBias(''); setDayNotes('')
      }
      setTrades(tradesData.trades ?? [])
    } finally {
      setSessionLoading(false)
      setTradesLoading(false)
    }
  }, [])

  const loadLiveTrades = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('trades').select('*').eq('user_id', user.id)
    setLiveTrades((data as Trade[]) ?? [])
  }, [supabase])

  useEffect(() => {
    loadSession(selectedDate)
  }, [selectedDate, loadSession])

  useEffect(() => {
    loadLiveTrades()
  }, [loadLiveTrades])

  async function handleSaveSession() {
    setSavingSession(true)
    try {
      const res = await fetch('/api/backtest/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          onh: onh ? parseFloat(onh) : null,
          onl: onl ? parseFloat(onl) : null,
          pdh: pdh ? parseFloat(pdh) : null,
          pdl: pdl ? parseFloat(pdl) : null,
          vwap: vwap ? parseFloat(vwap) : null,
          bias: bias || null,
          notes: dayNotes || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSession(data.session)
      toast.success('Session context saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingSession(false)
    }
  }

  function handleGateComplete(answers: GateAnswers) {
    setGateAnswers(answers)
    setGateOpen(false)
    setTradeFormOpen(true)
  }

  function handleEditGateComplete(answers: GateAnswers) {
    setEditGateAnswers(answers)
    setEditGateOpen(false)
    setTradeFormOpen(true)
  }

  function handleTradeSaved(trade: BacktestTrade) {
    if (editingTrade) {
      setTrades((prev) => prev.map((t) => t.id === trade.id ? trade : t))
    } else {
      setTrades((prev) => [...prev, trade])
    }
    setEditingTrade(null)
    setGateAnswers(null)
    setEditGateAnswers(null)
  }

  function handleTradeFormClose() {
    setTradeFormOpen(false)
    setEditingTrade(null)
    setGateAnswers(null)
    setEditGateAnswers(null)
  }

  function openEditTrade(trade: BacktestTrade) {
    setEditingTrade(trade)
    setEditGateOpen(true)
  }

  async function handleDeleteTrade(id: string) {
    if (!confirm('Delete this backtest trade?')) return
    const res = await fetch(`/api/backtest/trades/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setTrades((prev) => prev.filter((t) => t.id !== id))
      toast.success('Trade deleted')
    } else {
      toast.error('Delete failed')
    }
  }

  const stats = useMemo(() => computeStats(trades), [trades])

  // By setup
  const bySetup = useMemo(() => {
    const map: Record<string, BacktestTrade[]> = {}
    for (const t of trades) {
      const key = t.setup_tag || 'Untagged'
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    return Object.entries(map).map(([setup, ts]) => ({
      setup,
      count: ts.length,
      wins: ts.filter((t) => t.net_pnl > 0).length,
      winRate: (ts.filter((t) => t.net_pnl > 0).length / ts.length) * 100,
      totalPnL: ts.reduce((s, t) => s + t.net_pnl, 0),
    })).sort((a, b) => b.count - a.count)
  }, [trades])

  // By time window
  const byWindow = useMemo(() => {
    const map: Record<string, number[]> = {}
    for (const t of trades) {
      const w = getWindowLabel(t.entry_time)
      if (!map[w]) map[w] = []
      map[w].push(t.net_pnl)
    }
    return Object.entries(map).map(([window, pnls]) => ({
      window,
      count: pnls.length,
      totalPnL: pnls.reduce((s, p) => s + p, 0),
    }))
  }, [trades])

  // Grade breakdown
  const gradeBreakdown = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0, ungraded: 0 }
    for (const t of trades) {
      if (t.grade === 'A') counts.A++
      else if (t.grade === 'B') counts.B++
      else if (t.grade === 'C') counts.C++
      else counts.ungraded++
    }
    return counts
  }, [trades])

  // Comparison
  const comparison = useMemo(() => {
    const allSetups = new Set([
      ...SYSTEM_SETUPS,
      ...trades.map((t) => t.setup_tag).filter(Boolean),
      ...liveTrades.map((t) => t.setup_tag).filter(Boolean),
    ])
    return Array.from(allSetups).map((setup) => {
      const bt = trades.filter((t) => t.setup_tag === setup)
      const live = liveTrades.filter((t) => t.setup_tag === setup)
      return {
        setup: setup as string,
        backtest: {
          count: bt.length,
          winRate: bt.length ? (bt.filter((t) => t.net_pnl > 0).length / bt.length) * 100 : 0,
          avgPnL: bt.length ? bt.reduce((s, t) => s + t.net_pnl, 0) / bt.length : 0,
        },
        live: {
          count: live.length,
          winRate: live.length ? (live.filter((t) => t.net_pnl > 0).length / live.length) * 100 : 0,
          avgPnL: live.length ? live.reduce((s, t) => s + t.net_pnl, 0) / live.length : 0,
        },
      }
    }).filter((r) => r.backtest.count > 0 || r.live.count > 0)
  }, [trades, liveTrades])

  // Edge decay — only setups with BOTH backtest and live trades can be scored.
  // Sorted worst-first (most negative win-rate decay on top) so the setups that
  // are fooling you surface immediately.
  const edgeDecay = useMemo(() => {
    return comparison
      .filter((r) => r.backtest.count > 0 && r.live.count > 0)
      .map((r) => {
        const winRateDecay = r.live.winRate - r.backtest.winRate
        const avgPnLDecay = r.live.avgPnL - r.backtest.avgPnL
        const sampleSize = Math.min(r.backtest.count, r.live.count)
        const verdict = classifyEdge({
          winRateDecay,
          avgPnLDecay,
          liveAvgPnL: r.live.avgPnL,
          backtestAvgPnL: r.backtest.avgPnL,
          sampleSize,
        })
        return {
          setup: r.setup,
          winRateDecay,
          avgPnLDecay,
          sampleSize,
          backtestCount: r.backtest.count,
          liveCount: r.live.count,
          verdict,
        }
      })
      .sort((a, b) => a.winRateDecay - b.winRateDecay)
  }, [comparison])

  async function handleAiSummary() {
    if (comparison.length === 0) {
      toast.error('No comparison data available yet')
      return
    }
    setAiLoading(true)
    setAiSummary('')
    try {
      const res = await fetch('/api/claude/backtest-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comparison }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAiSummary(data.summary)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI analysis failed')
    } finally {
      setAiLoading(false)
    }
  }

  const activeGateAnswers = gateAnswers ?? editGateAnswers

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Backtest</h1>
          <p className="text-sm text-gray-400 mt-1">Blind engine · Replay sessions · Evaluate system discipline</p>
        </div>
        {topTab === 'manual' && (
          <div className="flex items-center gap-3">
            <label className="text-xs text-gray-500">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      {/* Top-level mode tabs */}
      <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1 w-fit">
        <button onClick={() => setTopTab('blind')}
          className={cn('px-5 py-2 rounded-lg text-sm font-medium transition',
            topTab === 'blind' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
          🎯 Blind Engine
        </button>
        <button onClick={() => setTopTab('manual')}
          className={cn('px-5 py-2 rounded-lg text-sm font-medium transition',
            topTab === 'manual' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
          📋 Session Log
        </button>
      </div>

      {/* Blind Backtest Engine */}
      {topTab === 'blind' && <BlindBacktestClient />}

      {/* Manual session log (existing content) */}
      {topTab === 'manual' && (
      <div className="space-y-6">

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1 w-fit">
        {(['session', 'analytics', 'comparison'] as PageTab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-5 py-2 rounded-lg text-sm font-medium transition capitalize',
              tab === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
            {t === 'comparison' ? 'Compare & AI' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* SESSION TAB */}
      {tab === 'session' && (
        <div className="space-y-5">
          {/* Session context */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-200 mb-4">Session Context — {format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMM d yyyy')}</h2>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'ONH', value: onh, set: setOnh },
                { label: 'ONL', value: onl, set: setOnl },
                { label: 'PDH', value: pdh, set: setPdh },
                { label: 'PDL', value: pdl, set: setPdl },
                { label: 'VWAP', value: vwap, set: setVwap },
              ].map(({ label, value, set }) => (
                <div key={label}>
                  <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                  <input type="number" step="0.25" value={value} onChange={(e) => set(e.target.value)}
                    placeholder="—"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">1H Bias</label>
                <select value={bias} onChange={(e) => setBias(e.target.value as 'Bull' | 'Bear' | 'Neutral' | '')}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select…</option>
                  <option value="Bull">Bull</option>
                  <option value="Bear">Bear</option>
                  <option value="Neutral">Neutral</option>
                </select>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-400 mb-1">Day Notes</label>
              <textarea value={dayNotes} onChange={(e) => setDayNotes(e.target.value)} rows={2}
                placeholder="Market context, key observations for this day..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
            <button onClick={handleSaveSession} disabled={savingSession || sessionLoading}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
              {savingSession ? 'Saving…' : 'Save Context'}
            </button>
          </div>

          {/* Trade list */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700/50 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-200">Backtest Trades</h2>
                <p className="text-xs text-gray-500 mt-0.5">{trades.length} trades logged · Net {formatCurrency(stats.totalPnL)}</p>
              </div>
              <button onClick={() => setGateOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition">
                <Plus className="h-4 w-4" />
                Log Trade
              </button>
            </div>

            {tradesLoading ? (
              <div className="px-5 py-8 text-center text-gray-500 text-sm">Loading…</div>
            ) : trades.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-gray-400 font-medium">No trades yet for this date</p>
                <p className="text-gray-600 text-sm mt-1">Click &ldquo;Log Trade&rdquo; to start backtesting</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      {['Time', 'Dir', 'Qty', 'Entry', 'Exit', 'Net P&L', 'Setup', 'Grade', 'Bias', ''].map((h) => (
                        <th key={h} className={cn('px-4 py-3 text-xs font-semibold text-gray-400', h === 'Net P&L' || h === 'Entry' || h === 'Exit' ? 'text-right' : 'text-left')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade) => (
                      <tr key={trade.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                        <td className="px-4 py-3 text-gray-400 text-xs">{trade.entry_time || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded',
                            trade.direction === 'long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                            {trade.direction === 'long' ? 'L' : 'S'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{trade.quantity}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{trade.entry_price.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-gray-300 font-mono text-xs">{trade.exit_price.toFixed(2)}</td>
                        <td className={cn('px-4 py-3 text-right font-semibold text-xs', trade.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {formatCurrency(trade.net_pnl)}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs max-w-[100px] truncate">{trade.setup_tag || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          {trade.grade ? (
                            <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded',
                              trade.grade === 'A' ? 'bg-emerald-500/10 text-emerald-400' :
                              trade.grade === 'B' ? 'bg-yellow-500/10 text-yellow-400' :
                              'bg-red-500/10 text-red-400')}>
                              {trade.grade}
                            </span>
                          ) : <span className="text-gray-600 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{trade.trade_bias || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => openEditTrade(trade)}
                              className="p-1 rounded text-gray-600 hover:text-blue-400 transition">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteTrade(trade.id)}
                              className="p-1 rounded text-gray-600 hover:text-red-400 transition">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ANALYTICS TAB */}
      {tab === 'analytics' && (
        <div className="space-y-5">
          {trades.length === 0 ? (
            <div className="text-center py-16 text-gray-500">Log some backtest trades first</div>
          ) : (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                  { label: 'Total Trades', value: stats.total.toString(), color: 'text-white' },
                  { label: 'Win Rate', value: `${stats.winRate.toFixed(1)}%`, color: stats.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400' },
                  { label: 'Net P&L', value: formatCurrency(stats.totalPnL), color: stats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'Profit Factor', value: stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2), color: stats.profitFactor >= 1 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'Avg R', value: stats.avgR !== null ? `${stats.avgR > 0 ? '+' : ''}${stats.avgR.toFixed(2)}R` : '—', color: stats.avgR !== null && stats.avgR >= 0 ? 'text-emerald-400' : 'text-red-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 text-center">
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className={cn('text-xl font-bold', color)}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Win rate by setup */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-200 mb-4">Win Rate by Setup</h3>
                {bySetup.length === 0 ? (
                  <p className="text-gray-500 text-sm">No setup-tagged trades</p>
                ) : (
                  <div className="space-y-3">
                    {bySetup.map(({ setup, count, wins, winRate, totalPnL }) => (
                      <div key={setup}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-gray-300">{setup}</span>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="text-gray-500">{wins}/{count} trades</span>
                            <span className={cn('font-semibold', totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>{formatCurrency(totalPnL)}</span>
                            <span className={cn('font-bold', winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400')}>{winRate.toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', winRate >= 50 ? 'bg-emerald-500' : 'bg-yellow-500')}
                            style={{ width: `${winRate}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* P&L by time window */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-200 mb-4">P&L by Time Window</h3>
                {byWindow.length === 0 ? (
                  <p className="text-gray-500 text-sm">No trades with entry times logged</p>
                ) : (
                  <div className="space-y-2">
                    {byWindow.map(({ window, count, totalPnL }) => (
                      <div key={window} className="flex items-center justify-between py-2 border-b border-gray-700/30">
                        <span className="text-sm text-gray-300">{window}</span>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-gray-500">{count} trade{count !== 1 ? 's' : ''}</span>
                          <span className={cn('font-semibold', totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>{formatCurrency(totalPnL)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Grade breakdown */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-200 mb-4">Trade Grade Breakdown</h3>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'A Grade', count: gradeBreakdown.A, color: 'text-emerald-400', bar: 'bg-emerald-500' },
                    { label: 'B Grade', count: gradeBreakdown.B, color: 'text-yellow-400', bar: 'bg-yellow-500' },
                    { label: 'C Grade', count: gradeBreakdown.C, color: 'text-red-400', bar: 'bg-red-500' },
                    { label: 'Ungraded', count: gradeBreakdown.ungraded, color: 'text-gray-500', bar: 'bg-gray-600' },
                  ].map(({ label, count, color, bar }) => (
                    <div key={label} className="text-center">
                      <p className={cn('text-2xl font-bold', color)}>{count}</p>
                      <p className="text-xs text-gray-500">{label}</p>
                      {stats.total > 0 && (
                        <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', bar)} style={{ width: `${(count / stats.total) * 100}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* COMPARISON & AI TAB */}
      {tab === 'comparison' && (
        <div className="space-y-5">
          {/* Edge Decay Scorecard */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700/50">
              <h2 className="text-sm font-semibold text-gray-200">Edge Decay Scorecard</h2>
              <p className="text-xs text-gray-500 mt-0.5">How well each backtested edge is holding up live · worst first</p>
            </div>
            {edgeDecay.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-500 text-sm">
                Need at least one setup with <span className="text-gray-400">both</span> backtest and live trades to score decay.
              </div>
            ) : (
              <div className="divide-y divide-gray-700/30">
                {edgeDecay.map((row) => (
                  <div key={row.setup} className="px-5 py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-200 truncate">{row.setup}</span>
                        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', EDGE_TONE_CLASSES[row.verdict.tone])}>
                          {row.verdict.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {row.backtestCount} backtest · {row.liveCount} live
                        {row.sampleSize < 5 && <span className="text-amber-500/80"> · low sample</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn('text-lg font-bold tabular-nums',
                        row.winRateDecay >= 0 ? 'text-emerald-400' : row.winRateDecay <= -15 ? 'text-red-400' : 'text-amber-400')}>
                        {row.winRateDecay > 0 ? '+' : ''}{row.winRateDecay.toFixed(0)}%
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">win-rate decay</p>
                    </div>
                    <div className="text-right w-24">
                      <p className={cn('text-sm font-semibold tabular-nums',
                        row.avgPnLDecay >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {row.avgPnLDecay > 0 ? '+' : ''}{formatCurrency(row.avgPnLDecay)}
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wide">avg $ decay</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Comparison table */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700/50">
              <h2 className="text-sm font-semibold text-gray-200">Backtest vs Live — by Setup</h2>
              <p className="text-xs text-gray-500 mt-0.5">All backtest trades vs all live journal trades</p>
            </div>
            {comparison.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-500 text-sm">No data to compare yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Setup</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-blue-400" colSpan={3}>Backtest</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-emerald-400" colSpan={3}>Live</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400">Win Rate Gap</th>
                    </tr>
                    <tr className="border-b border-gray-700/30 text-xs text-gray-500">
                      <th className="px-4 py-1" />
                      <th className="px-4 py-1 text-center text-blue-400/70">Trades</th>
                      <th className="px-4 py-1 text-center text-blue-400/70">Win%</th>
                      <th className="px-4 py-1 text-center text-blue-400/70">Avg P&L</th>
                      <th className="px-4 py-1 text-center text-emerald-400/70">Trades</th>
                      <th className="px-4 py-1 text-center text-emerald-400/70">Win%</th>
                      <th className="px-4 py-1 text-center text-emerald-400/70">Avg P&L</th>
                      <th className="px-4 py-1 text-center" />
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((row) => {
                      const gap = row.live.count > 0 && row.backtest.count > 0
                        ? row.live.winRate - row.backtest.winRate : null
                      return (
                        <tr key={row.setup} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                          <td className="px-4 py-3 text-gray-300 text-xs font-medium">{row.setup}</td>
                          <td className="px-4 py-3 text-center text-gray-400 text-xs">{row.backtest.count || '—'}</td>
                          <td className="px-4 py-3 text-center text-xs">
                            {row.backtest.count > 0
                              ? <span className={cn('font-semibold', row.backtest.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400')}>{row.backtest.winRate.toFixed(0)}%</span>
                              : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center text-xs">
                            {row.backtest.count > 0
                              ? <span className={cn('font-semibold', row.backtest.avgPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>{formatCurrency(row.backtest.avgPnL)}</span>
                              : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center text-gray-400 text-xs">{row.live.count || '—'}</td>
                          <td className="px-4 py-3 text-center text-xs">
                            {row.live.count > 0
                              ? <span className={cn('font-semibold', row.live.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400')}>{row.live.winRate.toFixed(0)}%</span>
                              : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center text-xs">
                            {row.live.count > 0
                              ? <span className={cn('font-semibold', row.live.avgPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>{formatCurrency(row.live.avgPnL)}</span>
                              : <span className="text-gray-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {gap !== null ? (
                              <div className="flex items-center justify-center gap-1">
                                {gap > 0 ? <TrendingUp className="h-3 w-3 text-emerald-400" /> : gap < 0 ? <TrendingDown className="h-3 w-3 text-red-400" /> : null}
                                <span className={cn('text-xs font-semibold',
                                  gap > 5 ? 'text-emerald-400' : gap < -5 ? 'text-red-400' : 'text-gray-400')}>
                                  {gap > 0 ? '+' : ''}{gap.toFixed(0)}%
                                </span>
                              </div>
                            ) : <span className="text-gray-600 text-xs">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* AI Summary */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-200">AI Behavioral Gap Analysis</h2>
                <p className="text-xs text-gray-500 mt-0.5">Identifies why backtest results differ from live performance</p>
              </div>
              <button onClick={handleAiSummary} disabled={aiLoading || comparison.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
                <Brain className="h-4 w-4" />
                {aiLoading ? 'Analyzing…' : 'Generate Analysis'}
              </button>
            </div>
            {aiSummary ? (
              <div className="bg-gray-900/60 rounded-lg p-4 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {aiSummary}
              </div>
            ) : (
              <p className="text-gray-600 text-sm">Click &ldquo;Generate Analysis&rdquo; to get an AI-powered behavioral gap report.</p>
            )}
          </div>
        </div>
      )}

      {/* Five-Word Gate — new trade */}
      <Modal open={gateOpen} onClose={() => setGateOpen(false)} title="Bias · Setup · Trigger · Location · Risk" className="max-w-md">
        <FiveWordGateModal onComplete={handleGateComplete} onCancel={() => setGateOpen(false)} />
      </Modal>

      {/* Five-Word Gate — edit trade */}
      <Modal open={editGateOpen} onClose={() => { setEditGateOpen(false); setEditingTrade(null) }} title="Bias · Setup · Trigger · Location · Risk" className="max-w-md">
        <FiveWordGateModal onComplete={handleEditGateComplete} onCancel={() => { setEditGateOpen(false); setEditingTrade(null) }} />
      </Modal>

      {/* Trade form */}
      <Modal
        open={tradeFormOpen && activeGateAnswers !== null}
        onClose={handleTradeFormClose}
        title={editingTrade ? 'Edit Backtest Trade' : 'Log Backtest Trade'}
        className="max-w-xl"
      >
        {activeGateAnswers && (
          <BacktestTradeForm
            date={selectedDate}
            sessionId={session?.id ?? null}
            gateAnswers={activeGateAnswers}
            editingTrade={editingTrade ?? undefined}
            onSaved={handleTradeSaved}
            onClose={handleTradeFormClose}
          />
        )}
      </Modal>
      </div>
      )}
    </div>
  )
}
