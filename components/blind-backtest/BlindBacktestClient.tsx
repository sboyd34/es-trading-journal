'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import toast from 'react-hot-toast'
import { cn, formatCurrency } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { BlindBacktestSession, BlindBacktestTrade } from '@/types'
import {
  Settings, Play, ChevronRight, Trophy, TrendingUp, TrendingDown,
  Minus, Brain, RefreshCw, Target, AlertCircle, Eye, Camera,
} from 'lucide-react'
import type { Candle } from './CandlestickChart'
import ImageUploadSlot from '@/components/ui/ImageUploadSlot'

const CHART_BUCKET = 'trade-charts'

const CandlestickChart = dynamic(() => import('./CandlestickChart'), { ssr: false })
const TradeReplayModal = dynamic(() => import('./TradeReplayModal'), { ssr: false })
const StatsView = dynamic(() => import('./StatsView'), { ssr: false })

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'home' | 'session-setup' | 'charting' | 'reveal' | 'grading' | 'complete'
type HomeTab = 'overview' | 'stats'

interface SessionConfig {
  setupFilter: string
  timeWindowFilter: string
  tradeCount: number
  contractType: 'ES' | 'MES'
}

interface ChartData {
  blindCandles: Candle[]
  fullCandles: Candle[]
  cutoffIndex: number
  cutoffTimeCT: string
  historicalDate: string
  ticker: string
}

interface TradeForm {
  bias: string
  setup: string
  trigger: string
  location: string
  risk: string
  entryPrice: string
  stopPrice: string
  targetPrice: string
  direction: string
  confidence: string
}

interface OutcomeData {
  outcome: 'WIN' | 'LOSS' | 'SCRATCH'
  exitPrice: number
  grossPnl: number
  rMultiple: number
  mfe: number  // max favorable excursion, in price points (>= 0)
  mae: number  // max adverse excursion, in price points (>= 0)
}

interface AiGradeResult {
  grade: 'A' | 'B' | 'C'
  well: string
  improve: string
}

interface SessionStats {
  total: number
  wins: number
  losses: number
  scratches: number
  avgR: number | null
  bestR: number | null
  worstR: number | null
  bestTrade: BlindBacktestTrade | null
  worstTrade: BlindBacktestTrade | null
  grades: { A: number; B: number; C: number }
  selfGrades: { A: number; B: number; C: number }
  avgConfidence: number | null
}

interface AppStats {
  total: number
  wins: number
  losses: number
  scratches: number
  avgR: number | null
  bestR: number | null
  winRate: number
  grades: { A: number; B: number; C: number }
}

interface LocalSettings {
  contractType: 'ES' | 'MES'
  defaultTradeCount: number
}

const EMPTY_FORM: TradeForm = {
  bias: '', setup: '', trigger: '', location: '', risk: '',
  entryPrice: '', stopPrice: '', targetPrice: '', direction: '', confidence: '',
}

const SETUPS = ['ORB', 'TTM Squeeze', 'AVWAP', 'FVG', 'Divergence']
const TIME_WINDOWS = ['All', 'Pre-market', '8:30 open', '9:30', '10:00-11:00', '11:00-13:00', '13:00-14:30', '14:30-15:00', '15:00 close']
const MOODS = ['Calm', 'Focused', 'Hesitant', 'Impulsive', 'Anxious', 'Confident']

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadSettings(): LocalSettings {
  if (typeof window === 'undefined') return { contractType: 'ES', defaultTradeCount: 10 }
  try {
    const s = localStorage.getItem('blindBacktestSettings')
    return s ? JSON.parse(s) : { contractType: 'ES', defaultTradeCount: 10 }
  } catch { return { contractType: 'ES', defaultTradeCount: 10 } }
}

function saveSettings(s: LocalSettings) {
  if (typeof window !== 'undefined') localStorage.setItem('blindBacktestSettings', JSON.stringify(s))
}

function calculateOutcome(
  afterCutoff: Candle[],
  entry: number,
  stop: number,
  target: number,
  dir: string,
  contractType: string,
): OutcomeData {
  const pv = contractType === 'MES' ? 5 : 50
  let mfe = 0
  let mae = 0

  for (const c of afterCutoff) {
    if (dir === 'long') {
      mfe = Math.max(mfe, c.h - entry)
      mae = Math.max(mae, entry - c.l)
      if (c.l <= stop) {
        const pnl = (stop - entry) * pv
        const risk = Math.abs(entry - stop) * pv
        return { outcome: 'LOSS', exitPrice: stop, grossPnl: pnl, rMultiple: risk > 0 ? pnl / risk : -1, mfe, mae }
      }
      if (c.h >= target) {
        const pnl = (target - entry) * pv
        const risk = Math.abs(entry - stop) * pv
        return { outcome: 'WIN', exitPrice: target, grossPnl: pnl, rMultiple: risk > 0 ? pnl / risk : 1, mfe, mae }
      }
    } else {
      mfe = Math.max(mfe, entry - c.l)
      mae = Math.max(mae, c.h - entry)
      if (c.h >= stop) {
        const pnl = (entry - stop) * pv
        const risk = Math.abs(stop - entry) * pv
        return { outcome: 'LOSS', exitPrice: stop, grossPnl: pnl, rMultiple: risk > 0 ? pnl / risk : -1, mfe, mae }
      }
      if (c.l <= target) {
        const pnl = (entry - target) * pv
        const risk = Math.abs(stop - entry) * pv
        return { outcome: 'WIN', exitPrice: target, grossPnl: pnl, rMultiple: risk > 0 ? pnl / risk : 1, mfe, mae }
      }
    }
  }

  const lastClose = afterCutoff[afterCutoff.length - 1]?.c ?? entry
  const pnl = dir === 'long' ? (lastClose - entry) * pv : (entry - lastClose) * pv
  const risk = Math.abs(entry - stop) * pv
  return { outcome: 'SCRATCH', exitPrice: lastClose, grossPnl: pnl, rMultiple: risk > 0 ? pnl / risk : 0, mfe, mae }
}

function gradeColor(g: string | null) {
  if (g === 'A') return 'text-emerald-400'
  if (g === 'B') return 'text-yellow-400'
  if (g === 'C') return 'text-red-400'
  return 'text-gray-500'
}

function gradeBg(g: string | null) {
  if (g === 'A') return 'bg-emerald-500/10 text-emerald-400'
  if (g === 'B') return 'bg-yellow-500/10 text-yellow-400'
  if (g === 'C') return 'bg-red-500/10 text-red-400'
  return 'bg-gray-700/50 text-gray-500'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BlindBacktestClient() {
  // Render only after mount — avoids hydration mismatches caused by
  // browser extensions injecting wrappers around SVG icons.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [phase, setPhase] = useState<Phase>('home')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [localSettings, setLocalSettings] = useState<LocalSettings>(loadSettings)

  // Session management
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [config, setConfig] = useState<SessionConfig>({
    setupFilter: 'All',
    timeWindowFilter: 'All',
    tradeCount: localSettings.defaultTradeCount,
    contractType: localSettings.contractType,
  })
  const [tradeIndex, setTradeIndex] = useState(0)
  const [sessionTrades, setSessionTrades] = useState<BlindBacktestTrade[]>([])

  // Charting phase
  const [chartData, setChartData] = useState<ChartData | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState<string | null>(null)
  const [form, setForm] = useState<TradeForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  // Reveal phase
  const [outcome, setOutcome] = useState<OutcomeData | null>(null)

  // Grading phase
  const [aiGrade, setAiGrade] = useState<AiGradeResult | null>(null)
  const [aiGrading, setAiGrading] = useState(false)
  const [selfGrade, setSelfGrade] = useState<'A' | 'B' | 'C' | ''>('')
  const [gradeMood, setGradeMood] = useState('')
  const [gradeNotes, setGradeNotes] = useState('')
  const [gradeReflection, setGradeReflection] = useState('')
  const [gradeChartUrl, setGradeChartUrl] = useState<string | null>(null)
  const [gradeChartUploading, setGradeChartUploading] = useState(false)
  const [gradeChartRef, setGradeChartRef] = useState<string>(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`
  )
  const [saving, setSaving] = useState(false)

  // Complete phase
  const [sessionNote, setSessionNote] = useState('')
  const [sessionNoteLoading, setSessionNoteLoading] = useState(false)

  // Home stats
  const [homeTab, setHomeTab] = useState<HomeTab>('overview')
  const [appStats, setAppStats] = useState<AppStats | null>(null)
  const [recentSessions, setRecentSessions] = useState<BlindBacktestSession[]>([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [expandedTrades, setExpandedTrades] = useState<BlindBacktestTrade[]>([])
  const [expandedLoading, setExpandedLoading] = useState(false)

  // Stats tab data (full trade list)
  const [allTrades, setAllTrades] = useState<BlindBacktestTrade[]>([])
  const [allTradesLoaded, setAllTradesLoaded] = useState(false)
  const [allTradesLoading, setAllTradesLoading] = useState(false)

  // Replay modal
  const [replayTrade, setReplayTrade] = useState<BlindBacktestTrade | null>(null)

  // ── Data loaders ─────────────────────────────────────────────────────────

  const loadHomeStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const [statsRes, sessRes] = await Promise.all([
        fetch('/api/blind-backtest/trades'),
        fetch('/api/blind-backtest/sessions'),
      ])
      const statsData = await statsRes.json()
      const sessData  = await sessRes.json()
      if (statsRes.ok) setAppStats(statsData)
      if (sessRes.ok) setRecentSessions(sessData.sessions ?? [])
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeStats()
  }, [loadHomeStats])

  const loadAllTrades = useCallback(async () => {
    setAllTradesLoading(true)
    try {
      const res = await fetch('/api/blind-backtest/trades?detail=1')
      const data = await res.json()
      if (res.ok) {
        setAllTrades((data.trades ?? []) as BlindBacktestTrade[])
        setAllTradesLoaded(true)
      }
    } finally {
      setAllTradesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (phase === 'home' && homeTab === 'stats' && !allTradesLoaded && !allTradesLoading) {
      loadAllTrades()
    }
  }, [phase, homeTab, allTradesLoaded, allTradesLoading, loadAllTrades])

  async function loadChart() {
    setChartLoading(true)
    setChartError(null)
    setChartData(null)
    try {
      const params = new URLSearchParams({ timeWindowFilter: config.timeWindowFilter })
      const res = await fetch(`/api/blind-backtest/chart?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load chart')
      setChartData(data)
    } catch (err) {
      setChartError(err instanceof Error ? err.message : 'Failed to load chart')
    } finally {
      setChartLoading(false)
    }
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

  async function startSession() {
    try {
      const res = await fetch('/api/blind-backtest/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setup_filter: config.setupFilter,
          time_window_filter: config.timeWindowFilter,
          total_trades_planned: config.tradeCount,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSessionId(data.session.id)
      setTradeIndex(0)
      setSessionTrades([])
      setPhase('charting')
      await loadChart()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start session')
    }
  }

  // ── Trade submission (charting → reveal) ──────────────────────────────────

  const formValid = useMemo(() => {
    return Object.values(form).every((v) => v.trim() !== '')
  }, [form])

  async function handleSubmitPlan() {
    if (!formValid || !chartData) return
    setSubmitting(true)
    try {
      const entry  = parseFloat(form.entryPrice)
      const stop   = parseFloat(form.stopPrice)
      const target = parseFloat(form.targetPrice)

      // Calculate outcome from after-cutoff candles
      const afterCutoff = chartData.fullCandles.slice(chartData.cutoffIndex + 1)
      const result = calculateOutcome(afterCutoff, entry, stop, target, form.direction, config.contractType)
      setOutcome(result)
      setPhase('reveal')

      // Fetch AI grade in background
      setAiGrading(true)
      fetch('/api/claude/blind-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trade_bias: form.bias,
          trade_setup: form.setup,
          trade_trigger: form.trigger,
          trade_location: form.location,
          trade_risk: form.risk,
          entry_price: entry,
          stop_price: stop,
          target_price: target,
          direction: form.direction,
          confidence: parseInt(form.confidence),
          outcome: result.outcome,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.grade) setAiGrade({ grade: d.grade, well: d.well, improve: d.improve })
        })
        .finally(() => setAiGrading(false))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Save trade + advance (grading → charting or complete) ─────────────────

  async function handleSaveAndNext() {
    if (!chartData || !outcome || !sessionId) return
    setSaving(true)
    try {
      const entry = parseFloat(form.entryPrice)
      const stop  = parseFloat(form.stopPrice)
      const target = parseFloat(form.targetPrice)

      const res = await fetch('/api/blind-backtest/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id:        sessionId,
          historical_date:   chartData.historicalDate,
          instrument:        config.contractType,
          contract_type:     config.contractType,
          chart_cutoff_time: chartData.cutoffTimeCT,
          trade_bias:        form.bias,
          trade_setup:       form.setup,
          trade_trigger:     form.trigger,
          trade_location:    form.location,
          trade_risk:        form.risk,
          entry_price:       entry,
          stop_price:        stop,
          target_price:      target,
          direction:         form.direction,
          confidence:        parseInt(form.confidence),
          outcome:           outcome.outcome,
          gross_pnl:         outcome.grossPnl,
          r_multiple:        outcome.rMultiple,
          mfe:               outcome.mfe,
          mae:               outcome.mae,
          ai_grade:          aiGrade?.grade ?? null,
          ai_feedback:       aiGrade ? `${aiGrade.well} ${aiGrade.improve}` : null,
          self_grade:        selfGrade || null,
          mood:              gradeMood || null,
          notes:             gradeNotes || null,
          reflection:        gradeReflection || null,
          chart_url:         gradeChartUrl ? gradeChartUrl.split('?')[0] : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const newTrades = [...sessionTrades, data.trade as BlindBacktestTrade]
      setSessionTrades(newTrades)

      const nextIndex = tradeIndex + 1
      if (nextIndex >= config.tradeCount) {
        // Session complete
        await finalizeSession(newTrades)
      } else {
        // Next trade
        setTradeIndex(nextIndex)
        resetForNextTrade()
        setPhase('charting')
        await loadChart()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function resetForNextTrade() {
    setForm(EMPTY_FORM)
    setOutcome(null)
    setAiGrade(null)
    setAiGrading(false)
    setSelfGrade('')
    setGradeMood('')
    setGradeNotes('')
    setGradeReflection('')
    setGradeChartUrl(null)
    setGradeChartUploading(false)
    setGradeChartRef(
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`
    )
    setChartData(null)
  }

  // ── Grading chart upload ─────────────────────────────────────────────────

  async function handleGradeChartUpload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10 MB')
      return
    }
    setGradeChartUploading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        toast.error('Not signed in')
        return
      }
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${user.id}/blind/${gradeChartRef}/chart.${ext}`
      const { error: upErr } = await supabase.storage
        .from(CHART_BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data } = supabase.storage.from(CHART_BUCKET).getPublicUrl(path)
      setGradeChartUrl(`${data.publicUrl}?t=${Date.now()}`)
      toast.success('Chart uploaded')
    } catch (err) {
      toast.error('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setGradeChartUploading(false)
    }
  }

  async function handleGradeChartRemove() {
    if (!gradeChartUrl) return
    const supabase = createClient()
    const storagePath = gradeChartUrl.split(`/${CHART_BUCKET}/`)[1]?.split('?')[0]
    if (storagePath) {
      await supabase.storage.from(CHART_BUCKET).remove([storagePath])
    }
    setGradeChartUrl(null)
    toast.success('Chart removed')
  }

  async function finalizeSession(trades: BlindBacktestTrade[]) {
    // Compute summary stats
    const wins = trades.filter((t) => t.outcome === 'WIN').length
    const losses = trades.filter((t) => t.outcome === 'LOSS').length
    const scratches = trades.filter((t) => t.outcome === 'SCRATCH').length
    const rVals = trades.map((t) => t.r_multiple).filter((r): r is number => r != null)
    const avgR = rVals.length ? rVals.reduce((s, r) => s + r, 0) / rVals.length : null

    // Get AI session note
    setSessionNoteLoading(true)
    try {
      const noteRes = await fetch('/api/claude/blind-session-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trades: trades.map((t) => ({
            trade_setup: t.trade_setup,
            trade_trigger: t.trade_trigger,
            trade_risk: t.trade_risk,
            outcome: t.outcome,
            r_multiple: t.r_multiple,
            ai_grade: t.ai_grade,
            self_grade: t.self_grade,
            confidence: t.confidence,
          })),
        }),
      })
      const noteData = await noteRes.json()
      if (noteData.note) setSessionNote(noteData.note)

      // Update session record
      await fetch(`/api/blind-backtest/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wins, losses, scratches,
          avg_r_multiple: avgR,
          ai_session_note: noteData.note ?? null,
        }),
      })
    } finally {
      setSessionNoteLoading(false)
    }

    setPhase('complete')
  }

  // ── Session stats (for complete screen) ──────────────────────────────────

  const sessionStats = useMemo<SessionStats>(() => {
    const total = sessionTrades.length
    const wins  = sessionTrades.filter((t) => t.outcome === 'WIN').length
    const losses = sessionTrades.filter((t) => t.outcome === 'LOSS').length
    const scratches = sessionTrades.filter((t) => t.outcome === 'SCRATCH').length
    const rVals = sessionTrades.map((t) => t.r_multiple).filter((r): r is number => r != null)
    const avgR  = rVals.length ? rVals.reduce((s, r) => s + r, 0) / rVals.length : null
    const bestR = rVals.length ? Math.max(...rVals) : null
    const worstR = rVals.length ? Math.min(...rVals) : null
    const sorted = [...sessionTrades].sort((a, b) => (b.r_multiple ?? 0) - (a.r_multiple ?? 0))
    const grades = { A: 0, B: 0, C: 0 }
    const selfGrades = { A: 0, B: 0, C: 0 }
    const confVals: number[] = []
    for (const t of sessionTrades) {
      if (t.ai_grade === 'A') grades.A++
      else if (t.ai_grade === 'B') grades.B++
      else if (t.ai_grade === 'C') grades.C++
      if (t.self_grade === 'A') selfGrades.A++
      else if (t.self_grade === 'B') selfGrades.B++
      else if (t.self_grade === 'C') selfGrades.C++
      if (t.confidence) confVals.push(t.confidence)
    }
    const avgConfidence = confVals.length ? confVals.reduce((s, c) => s + c, 0) / confVals.length : null
    return {
      total, wins, losses, scratches, avgR, bestR, worstR,
      bestTrade: sorted[0] ?? null,
      worstTrade: sorted[sorted.length - 1] ?? null,
      grades, selfGrades, avgConfidence,
    }
  }, [sessionTrades])

  // ── Expand session detail on home ─────────────────────────────────────────

  async function toggleSessionExpand(id: string) {
    if (expandedSession === id) {
      setExpandedSession(null)
      return
    }
    setExpandedSession(id)
    setExpandedLoading(true)
    try {
      const res = await fetch(`/api/blind-backtest/sessions/${id}`)
      const data = await res.json()
      setExpandedTrades(data.trades ?? [])
    } finally {
      setExpandedLoading(false)
    }
  }

  // ── Settings update ───────────────────────────────────────────────────────

  function updateSettings(updates: Partial<LocalSettings>) {
    const next = { ...localSettings, ...updates }
    setLocalSettings(next)
    saveSettings(next)
    setConfig((c) => ({
      ...c,
      contractType:    next.contractType,
      tradeCount:      next.defaultTradeCount,
    }))
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function ProgressBar() {
    if (phase === 'charting' || phase === 'reveal' || phase === 'grading') {
      return (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span className="font-semibold text-white">Trade {tradeIndex + 1}</span>
          <span>of {config.tradeCount}</span>
          <div className="flex-1 h-1.5 bg-gray-700 rounded-full ml-2">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${((tradeIndex + 1) / config.tradeCount) * 100}%` }}
            />
          </div>
        </div>
      )
    }
    return null
  }

  // Block render until mounted (prevents extension-induced hydration mismatch)
  if (!mounted) {
    return <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-8 text-center text-sm text-gray-500">Loading…</div>
  }

  // ── PHASE: home ───────────────────────────────────────────────────────────

  if (phase === 'home') {
    return (
      <div className="space-y-6">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-blue-400 tracking-widest uppercase mb-1">Blind Backtest Engine</p>
            <p className="text-sm text-gray-400 italic">
              &ldquo;I am a disciplined, patient and objective trader.&rdquo;
            </p>
          </div>
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 transition"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {/* Settings panel */}
        {settingsOpen && (
          <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-200">Settings</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Contract Type</label>
                <select
                  value={localSettings.contractType}
                  onChange={(e) => updateSettings({ contractType: e.target.value as 'ES' | 'MES' })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="ES">ES ($50/point)</option>
                  <option value="MES">MES ($5/point)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Default trades/session</label>
                <select
                  value={localSettings.defaultTradeCount}
                  onChange={(e) => updateSettings({ defaultTradeCount: parseInt(e.target.value) })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} trades</option>)}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Overview / Stats tabs */}
        <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1 w-fit">
          <button onClick={() => setHomeTab('overview')}
            className={cn('px-4 py-1.5 rounded-lg text-xs font-semibold transition',
              homeTab === 'overview' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
            Overview
          </button>
          <button onClick={() => setHomeTab('stats')}
            className={cn('px-4 py-1.5 rounded-lg text-xs font-semibold transition',
              homeTab === 'stats' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white')}>
            Stats
          </button>
        </div>

        {homeTab === 'stats' ? (
          <StatsView trades={allTrades} loading={allTradesLoading && !allTradesLoaded} />
        ) : (
        <>
        {/* Stats strip */}
        {statsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 animate-pulse h-16" />
            ))}
          </div>
        ) : appStats && appStats.total > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: 'Total Trades', value: appStats.total.toString(), color: 'text-white' },
              { label: 'Win Rate', value: `${appStats.winRate.toFixed(1)}%`, color: appStats.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400' },
              { label: 'Avg R', value: appStats.avgR != null ? `${appStats.avgR > 0 ? '+' : ''}${appStats.avgR.toFixed(2)}R` : '—', color: appStats.avgR != null && appStats.avgR >= 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Best R', value: appStats.bestR != null ? `+${appStats.bestR.toFixed(2)}R` : '—', color: 'text-emerald-400' },
              { label: 'AI Grades', value: `${appStats.grades.A}A · ${appStats.grades.B}B · ${appStats.grades.C}C`, color: 'text-gray-300' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={cn('text-lg font-bold', color)}>{value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-4 text-center text-sm text-gray-500">
            No backtest history yet. Start your first session below.
          </div>
        )}

        {/* Start button */}
        <button
          onClick={() => setPhase('session-setup')}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-lg rounded-xl transition flex items-center justify-center gap-3 shadow-lg shadow-blue-900/30"
        >
          <Play className="h-5 w-5 fill-white" />
          Start Backtest Session
        </button>

        {/* Recent sessions */}
        {recentSessions.length > 0 && (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700/50">
              <h3 className="text-sm font-semibold text-gray-200">Recent Sessions</h3>
            </div>
            {recentSessions.map((s) => {
              const winRate = s.wins + s.losses + s.scratches > 0
                ? (s.wins / (s.wins + s.losses + s.scratches)) * 100 : 0
              return (
                <div key={s.id}>
                  <button
                    onClick={() => toggleSessionExpand(s.id)}
                    className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-700/20 transition border-b border-gray-700/30"
                  >
                    <div className="text-left">
                      <p className="text-sm text-gray-200">
                        {new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        <span className="ml-2 text-xs text-gray-500">{s.total_trades_planned} trades · {s.setup_filter}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className={cn('font-semibold', winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400')}>
                        {winRate.toFixed(0)}% W
                      </span>
                      {s.avg_r_multiple != null && (
                        <span className={cn('font-semibold', s.avg_r_multiple >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {s.avg_r_multiple > 0 ? '+' : ''}{s.avg_r_multiple.toFixed(2)}R
                        </span>
                      )}
                      <ChevronRight className={cn('h-4 w-4 text-gray-600 transition-transform', expandedSession === s.id && 'rotate-90')} />
                    </div>
                  </button>
                  {expandedSession === s.id && (
                    <div className="bg-gray-900/30 px-5 py-3 border-b border-gray-700/30">
                      {expandedLoading ? (
                        <p className="text-xs text-gray-500 py-2">Loading…</p>
                      ) : (
                        <>
                          {s.ai_session_note && (
                            <p className="text-xs text-blue-400/80 italic mb-3 leading-relaxed">{s.ai_session_note}</p>
                          )}
                          <div className="space-y-0.5">
                            {expandedTrades.map((t, i) => (
                              <button
                                key={t.id}
                                onClick={() => setReplayTrade(t)}
                                className="w-full group flex items-center gap-2 text-xs py-1.5 px-2 -mx-2 rounded hover:bg-gray-800/60 transition text-left"
                                title="Click to replay this trade"
                              >
                                <span className="text-gray-600 w-4">{i + 1}</span>
                                <span className={cn('font-semibold w-10',
                                  t.outcome === 'WIN' ? 'text-emerald-400' :
                                  t.outcome === 'LOSS' ? 'text-red-400' : 'text-gray-400')}>
                                  {t.outcome}
                                </span>
                                <span className="text-gray-500">{t.trade_setup ?? '—'}</span>
                                {t.r_multiple != null && (
                                  <span className={cn('ml-auto font-mono', t.r_multiple >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                    {t.r_multiple > 0 ? '+' : ''}{t.r_multiple.toFixed(2)}R
                                  </span>
                                )}
                                {t.ai_grade && (
                                  <span className={cn('px-1 rounded text-xs font-bold', gradeBg(t.ai_grade))}>
                                    {t.ai_grade}
                                  </span>
                                )}
                                <Eye className="h-3 w-3 text-gray-700 group-hover:text-blue-400 transition" />
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        </>
        )}

        <TradeReplayModal
          trade={replayTrade}
          open={replayTrade !== null}
          onClose={() => setReplayTrade(null)}
          onUpdated={(updated) => {
            setReplayTrade(updated)
            setExpandedTrades((ts) => ts.map((t) => (t.id === updated.id ? updated : t)))
            setAllTrades((ts) => ts.map((t) => (t.id === updated.id ? updated : t)))
          }}
        />
      </div>
    )
  }

  // ── PHASE: session-setup ──────────────────────────────────────────────────

  if (phase === 'session-setup') {
    return (
      <div className="space-y-6 max-w-xl mx-auto">
        <div>
          <h2 className="text-lg font-bold text-white">Configure Session</h2>
          <p className="text-sm text-gray-400 mt-1">Set your filters, then click Begin.</p>
        </div>

        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Setup Filter (optional)</label>
            <div className="flex flex-wrap gap-2">
              {['All', ...SETUPS].map((s) => (
                <button
                  key={s}
                  onClick={() => setConfig((c) => ({ ...c, setupFilter: s }))}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition',
                    config.setupFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700')}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Time Window Filter (cutoff zone)</label>
            <div className="flex flex-wrap gap-2">
              {TIME_WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => setConfig((c) => ({ ...c, timeWindowFilter: w }))}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition',
                    config.timeWindowFilter === w ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700')}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Number of Trades</label>
            <div className="flex gap-2">
              {[5, 10, 15, 20].map((n) => (
                <button
                  key={n}
                  onClick={() => setConfig((c) => ({ ...c, tradeCount: n }))}
                  className={cn('w-16 py-2 rounded-lg text-sm font-semibold transition',
                    config.tradeCount === n ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700')}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Contract</label>
            <div className="flex gap-2">
              {(['ES', 'MES'] as const).map((ct) => (
                <button
                  key={ct}
                  onClick={() => setConfig((c) => ({ ...c, contractType: ct }))}
                  className={cn('px-4 py-2 rounded-lg text-sm font-semibold transition',
                    config.contractType === ct ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700')}
                >
                  {ct} ({ct === 'ES' ? '$50/pt' : '$5/pt'})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => setPhase('home')}
            className="px-5 py-3 bg-gray-700/60 hover:bg-gray-700 text-gray-300 rounded-xl text-sm font-semibold transition">
            Cancel
          </button>
          <button onClick={startSession}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition flex items-center justify-center gap-2">
            Begin Session <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  // ── PHASE: charting ───────────────────────────────────────────────────────

  if (phase === 'charting') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Historical ES Session</h2>
            <p className="text-xs text-gray-500">Date hidden · Chart cuts off at {chartData?.cutoffTimeCT ?? '…'} CT</p>
          </div>
          <ProgressBar />
        </div>

        {chartLoading && (
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl flex items-center justify-center h-[380px]">
            <div className="text-center">
              <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto mb-2" />
              <p className="text-sm text-gray-400">Loading chart…</p>
            </div>
          </div>
        )}

        {chartError && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-red-300 font-medium">{chartError}</p>
              <button onClick={loadChart} className="mt-2 text-xs text-red-400 hover:text-red-300 underline">Retry</button>
            </div>
          </div>
        )}

        {chartData && !chartLoading && (
          <>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3">
              <CandlestickChart candles={chartData.blindCandles} height={380} />
            </div>

            {/* Five-Word Gate form */}
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-200">Five-Word Gate · Trade Plan</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Bias */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">1. Bias</label>
                  <div className="flex gap-2">
                    {['Bullish', 'Bearish', 'Neutral'].map((b) => (
                      <button key={b} onClick={() => setForm((f) => ({ ...f, bias: b }))}
                        className={cn('flex-1 py-2 rounded-lg text-xs font-semibold transition',
                          form.bias === b ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700')}>
                        {b}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Setup */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">2. Setup</label>
                  <select value={form.setup} onChange={(e) => setForm((f) => ({ ...f, setup: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                    <option value="">Select setup…</option>
                    {SETUPS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Trigger */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">3. Trigger</label>
                  <input value={form.trigger} onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}
                    placeholder="Exact 5m signal…"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
                </div>

                {/* Location */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">4. Location</label>
                  <input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="Key level / structure…"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
                </div>

                {/* Risk */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">5. Risk</label>
                  <input value={form.risk} onChange={(e) => setForm((f) => ({ ...f, risk: e.target.value }))}
                    placeholder="Stop placement and risk reasoning…"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600" />
                </div>
              </div>

              {/* Prices */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'entryPrice', label: 'Entry Price' },
                  { key: 'stopPrice',  label: 'Stop Loss' },
                  { key: 'targetPrice',label: 'Target' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
                    <input
                      type="number" step="0.25"
                      value={form[key as keyof TradeForm]}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      placeholder="0.00"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono"
                    />
                  </div>
                ))}
              </div>

              {/* Direction + Confidence */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Direction</label>
                  <div className="flex gap-2">
                    {['long', 'short'].map((d) => (
                      <button key={d} onClick={() => setForm((f) => ({ ...f, direction: d }))}
                        className={cn('flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition',
                          form.direction === d
                            ? d === 'long' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                            : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700')}>
                        {d === 'long' ? '▲ Long' : '▼ Short'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Confidence (1–5)</label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => setForm((f) => ({ ...f, confidence: String(n) }))}
                        className={cn('flex-1 py-2 rounded-lg text-xs font-bold transition',
                          form.confidence === String(n) ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-400 hover:bg-gray-700')}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onClick={handleSubmitPlan}
                disabled={!formValid || submitting}
                className={cn(
                  'w-full py-3 rounded-xl font-bold text-sm transition flex items-center justify-center gap-2',
                  formValid
                    ? 'bg-blue-600 hover:bg-blue-500 text-white'
                    : 'bg-gray-700/50 text-gray-500 cursor-not-allowed',
                )}
              >
                {submitting ? 'Calculating outcome…' : formValid ? 'Submit Trade Plan →' : 'Complete all fields to continue'}
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // ── PHASE: reveal ─────────────────────────────────────────────────────────

  if (phase === 'reveal' && chartData && outcome) {
    const entry  = parseFloat(form.entryPrice)
    const stop   = parseFloat(form.stopPrice)
    const target = parseFloat(form.targetPrice)
    const cutoffCandle = chartData.blindCandles[chartData.blindCandles.length - 1]
    const stopDist = Math.abs(entry - stop)
    const mfeR = stopDist > 0 ? outcome.mfe / stopDist : 0
    const maeR = stopDist > 0 ? outcome.mae / stopDist : 0

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Outcome Reveal</h2>
          <ProgressBar />
        </div>

        {/* Outcome banner */}
        <div className={cn('rounded-xl p-4 flex items-center gap-4',
          outcome.outcome === 'WIN' ? 'bg-emerald-900/30 border border-emerald-700/40' :
          outcome.outcome === 'LOSS' ? 'bg-red-900/30 border border-red-700/40' :
          'bg-gray-800/50 border border-gray-700/50')}>
          {outcome.outcome === 'WIN'  && <Trophy className="h-8 w-8 text-emerald-400 flex-shrink-0" />}
          {outcome.outcome === 'LOSS' && <TrendingDown className="h-8 w-8 text-red-400 flex-shrink-0" />}
          {outcome.outcome === 'SCRATCH' && <Minus className="h-8 w-8 text-gray-400 flex-shrink-0" />}
          <div className="flex-1">
            <p className={cn('text-2xl font-black',
              outcome.outcome === 'WIN' ? 'text-emerald-400' :
              outcome.outcome === 'LOSS' ? 'text-red-400' : 'text-gray-300')}>
              {outcome.outcome}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1">
              <span className="text-sm text-gray-400">
                P&L: <span className={cn('font-bold', outcome.grossPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>{formatCurrency(outcome.grossPnl)}</span>
              </span>
              <span className="text-sm text-gray-400">
                R: <span className={cn('font-bold', outcome.rMultiple >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {outcome.rMultiple > 0 ? '+' : ''}{outcome.rMultiple.toFixed(2)}R
                </span>
              </span>
              <span className="text-sm text-gray-400">
                MFE: <span className="font-bold text-emerald-400">+{mfeR.toFixed(2)}R</span>
              </span>
              <span className="text-sm text-gray-400">
                MAE: <span className="font-bold text-red-400">−{maeR.toFixed(2)}R</span>
              </span>
              <span className="text-sm text-gray-500">Exit: {outcome.exitPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Full chart with markers */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-3">
          <CandlestickChart
            candles={chartData.fullCandles}
            entryPrice={entry}
            stopPrice={stop}
            targetPrice={target}
            cutoffTimestamp={cutoffCandle?.t}
            direction={form.direction as 'long' | 'short'}
            height={380}
          />
        </div>

        {/* Trade plan summary */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Your Trade Plan</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {[
              ['Bias', form.bias],
              ['Setup', form.setup],
              ['Direction', form.direction === 'long' ? '▲ Long' : '▼ Short'],
              ['Entry', entry.toFixed(2)],
              ['Stop', stop.toFixed(2)],
              ['Target', target.toFixed(2)],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-gray-500">{label}</p>
                <p className="text-gray-200 font-medium capitalize">{val}</p>
              </div>
            ))}
            <div className="sm:col-span-3">
              <p className="text-gray-500">Trigger</p>
              <p className="text-gray-200">{form.trigger}</p>
            </div>
            <div className="sm:col-span-3">
              <p className="text-gray-500">Risk</p>
              <p className="text-gray-200">{form.risk}</p>
            </div>
          </div>
        </div>

        <button
          onClick={() => setPhase('grading')}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm transition"
        >
          Grade This Trade →
        </button>
      </div>
    )
  }

  // ── PHASE: grading ────────────────────────────────────────────────────────

  if (phase === 'grading' && outcome) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Grade This Trade</h2>
          <ProgressBar />
        </div>

        {/* AI Grade */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-gray-200">AI Coach Grade</h3>
          </div>
          {aiGrading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
              Analyzing your reasoning…
            </div>
          ) : aiGrade ? (
            <div className="flex items-start gap-4">
              <div className={cn('text-4xl font-black px-4 py-2 rounded-xl', gradeBg(aiGrade.grade))}>
                {aiGrade.grade}
              </div>
              <div className="flex-1 space-y-2 text-sm text-gray-300">
                <p><span className="text-emerald-400 font-medium">✓ </span>{aiGrade.well}</p>
                <p><span className="text-yellow-400 font-medium">△ </span>{aiGrade.improve}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Grade unavailable</p>
          )}
        </div>

        {/* Self Grade */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-200">Self Evaluation</h3>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Your Grade</label>
            <div className="flex gap-2">
              {(['A', 'B', 'C'] as const).map((g) => (
                <button key={g} onClick={() => setSelfGrade(g)}
                  className={cn('w-16 py-3 rounded-xl text-lg font-black transition',
                    selfGrade === g ? gradeBg(g) + ' border border-current/20' : 'bg-gray-700/50 text-gray-500 hover:bg-gray-700')}>
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Mood</label>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <button key={m} onClick={() => setGradeMood(m)}
                  className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition',
                    gradeMood === m ? 'bg-blue-600 text-white' : 'bg-gray-700/60 text-gray-300 hover:bg-gray-700')}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">What did you see?</label>
            <textarea value={gradeNotes} onChange={(e) => setGradeNotes(e.target.value)} rows={2}
              placeholder="Describe what you saw in the chart…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 resize-none" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">What would you do differently?</label>
            <textarea value={gradeReflection} onChange={(e) => setGradeReflection(e.target.value)} rows={2}
              placeholder="Reflection on process and execution…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 resize-none" />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Camera className="h-3.5 w-3.5 text-gray-400" />
              <label className="text-xs font-medium text-gray-400">Annotated Chart (optional)</label>
            </div>
            <ImageUploadSlot
              label=""
              currentUrl={gradeChartUrl}
              uploading={gradeChartUploading}
              onFile={handleGradeChartUpload}
              onClear={handleGradeChartRemove}
            />
          </div>
        </div>

        <button
          onClick={handleSaveAndNext}
          disabled={saving}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition"
        >
          {saving ? 'Saving…' : tradeIndex + 1 >= config.tradeCount ? 'Save & Complete Session ✓' : `Save & Next Trade (${tradeIndex + 1}/${config.tradeCount})`}
        </button>
      </div>
    )
  }

  // ── PHASE: complete ───────────────────────────────────────────────────────

  if (phase === 'complete') {
    const { total, wins, losses, scratches, avgR, bestR, worstR, grades, selfGrades, avgConfidence, bestTrade, worstTrade } = sessionStats

    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-black text-white">Session Complete</h2>
          <p className="text-sm text-gray-400 mt-1">
            {config.tradeCount} trades · {config.setupFilter} · {config.timeWindowFilter}
          </p>
        </div>

        {/* Summary stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Win / Loss / Scratch', value: `${wins} / ${losses} / ${scratches}`, color: wins > losses ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Win Rate', value: total ? `${((wins / total) * 100).toFixed(0)}%` : '—', color: wins / total >= 0.5 ? 'text-emerald-400' : 'text-yellow-400' },
            { label: 'Avg R', value: avgR != null ? `${avgR > 0 ? '+' : ''}${avgR.toFixed(2)}R` : '—', color: avgR != null && avgR >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Avg Confidence', value: avgConfidence != null ? `${avgConfidence.toFixed(1)}/5` : '—', color: 'text-gray-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className={cn('text-xl font-bold', color)}>{value}</p>
            </div>
          ))}
        </div>

        {/* Grade breakdown */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">AI Grades</p>
            <div className="flex gap-4">
              {(['A', 'B', 'C'] as const).map((g) => (
                <div key={g} className="text-center">
                  <p className={cn('text-2xl font-black', gradeColor(g))}>{grades[g]}</p>
                  <p className="text-xs text-gray-600">{g}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Self Grades</p>
            <div className="flex gap-4">
              {(['A', 'B', 'C'] as const).map((g) => (
                <div key={g} className="text-center">
                  <p className={cn('text-2xl font-black', gradeColor(g))}>{selfGrades[g]}</p>
                  <p className="text-xs text-gray-600">{g}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Best / Worst */}
        {(bestTrade || worstTrade) && (
          <div className="grid grid-cols-2 gap-4">
            {bestTrade && (
              <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  <p className="text-xs font-semibold text-emerald-400">Best Trade</p>
                </div>
                <p className="text-lg font-bold text-emerald-400">+{bestR?.toFixed(2)}R</p>
                <p className="text-xs text-gray-400 mt-1">{bestTrade.trade_setup ?? '—'} · {bestTrade.direction}</p>
              </div>
            )}
            {worstTrade && (
              <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="h-4 w-4 text-red-400" />
                  <p className="text-xs font-semibold text-red-400">Worst Trade</p>
                </div>
                <p className="text-lg font-bold text-red-400">{worstR?.toFixed(2)}R</p>
                <p className="text-xs text-gray-400 mt-1">{worstTrade.trade_setup ?? '—'} · {worstTrade.direction}</p>
              </div>
            )}
          </div>
        )}

        {/* AI coaching note */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-gray-200">Coach Focus — Next Session</h3>
          </div>
          {sessionNoteLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
              Generating coaching note…
            </div>
          ) : sessionNote ? (
            <p className="text-sm text-gray-300 leading-relaxed">{sessionNote}</p>
          ) : (
            <p className="text-sm text-gray-600">Coaching note unavailable</p>
          )}
        </div>

        {/* Trade list */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700/50">
            <h3 className="text-sm font-semibold text-gray-200">All Trades This Session</h3>
          </div>
          {sessionTrades.map((t, i) => (
            <div key={t.id} className="px-5 py-3 border-b border-gray-700/30 flex items-center gap-3 text-xs">
              <span className="text-gray-600 w-4">{i + 1}</span>
              <span className={cn('font-bold w-14',
                t.outcome === 'WIN' ? 'text-emerald-400' :
                t.outcome === 'LOSS' ? 'text-red-400' : 'text-gray-400')}>
                {t.outcome}
              </span>
              <span className="text-gray-400 flex-1">{t.trade_setup ?? '—'}</span>
              {t.r_multiple != null && (
                <span className={cn('font-mono font-semibold', t.r_multiple >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {t.r_multiple > 0 ? '+' : ''}{t.r_multiple.toFixed(2)}R
                </span>
              )}
              {t.ai_grade && <span className={cn('px-1.5 py-0.5 rounded font-bold', gradeBg(t.ai_grade))}>{t.ai_grade}</span>}
            </div>
          ))}
        </div>

        <button
          onClick={() => {
            setPhase('home')
            resetForNextTrade()
            setSessionId(null)
            setSessionTrades([])
            setTradeIndex(0)
            setSessionNote('')
            setAllTradesLoaded(false)
            loadHomeStats()
          }}
          className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-xl text-sm transition"
        >
          End Session → Return Home
        </button>
      </div>
    )
  }

  return null
}
