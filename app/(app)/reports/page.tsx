'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Trade, RiskRules } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, cn } from '@/lib/utils'
import { POINT_VALUES } from '@/lib/tradovate-parser'
import { format, parseISO, getHours, startOfWeek, startOfMonth, subDays } from 'date-fns'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
  ReferenceLine,
  Legend,
  LineChart,
  Line,
} from 'recharts'
import { Sparkles, Loader2 } from 'lucide-react'
import MonteCarloTab from '@/components/reports/MonteCarloTab'
import toast from 'react-hot-toast'

type Tab = 'overview' | 'hourly' | 'rmultiple' | 'maemfe' | 'drawdown' | 'direction' | 'emotion' | 'whatif' | 'montecarlo' | 'setups' | 'dayofweek' | 'emotiongrade'
type MatrixDim = 'time' | 'day' | 'bias'
type DateRange = 'this-week' | 'this-month' | 'last-30' | 'all-time'
type ScenarioId =
  | 'no-c-grade'
  | 'primary-window'
  | 'no-emotional'
  | 'cap-1r'
  | 'orb-only'
  | 'bull-bias'
  | 'a-grade-only'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'hourly', label: 'Hourly P&L' },
  { id: 'rmultiple', label: 'R-Multiple' },
  { id: 'maemfe', label: 'MAE/MFE' },
  { id: 'drawdown', label: 'Drawdown' },
  { id: 'direction', label: 'Direction' },
  { id: 'emotion', label: 'Emotion' },
  { id: 'whatif', label: 'What-If' },
  { id: 'montecarlo', label: 'Monte Carlo' },
  { id: 'setups', label: 'Setup Matrix' },
  { id: 'dayofweek', label: 'Day of Week' },
  { id: 'emotiongrade', label: 'Emotion × Grade' },
]

const DATE_RANGES: { id: DateRange; label: string }[] = [
  { id: 'this-week', label: 'This Week' },
  { id: 'this-month', label: 'This Month' },
  { id: 'last-30', label: 'Last 30 Days' },
  { id: 'all-time', label: 'All Time' },
]

const WHATIF_SCENARIOS: { id: ScenarioId; label: string; description: string }[] = [
  { id: 'no-c-grade', label: 'Exclude C-grade trades', description: 'Remove all trades graded C' },
  { id: 'primary-window', label: 'Primary window only', description: 'Keep only 08:45–09:30 CT trades' },
  { id: 'no-emotional', label: 'Exclude emotional trades', description: 'Remove FOMO, revenge, anxious, overconfident moods' },
  { id: 'cap-1r', label: 'Cap losses at 1R', description: 'Replace losses exceeding default risk with –1R' },
  { id: 'orb-only', label: 'ORB setup only', description: 'Keep only ORB-tagged trades' },
  { id: 'bull-bias', label: 'Bull bias days only', description: 'Keep only trades where bias = Bull' },
  { id: 'a-grade-only', label: 'A-grade trades only', description: 'Keep only A-grade trades' },
]

const tooltipStyle = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#f3f4f6',
  },
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-60 text-gray-500 text-sm">{message}</div>
  )
}

// ── What-If helpers ────────────────────────────────────────────────────────────

function isInPrimaryWindow(entryTime: string): boolean {
  try {
    const date = new Date(entryTime)
    const ctStr = date.toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
    const [h, m] = ctStr.split(':').map(Number)
    const totalMinutes = h * 60 + m
    return totalMinutes >= 8 * 60 + 45 && totalMinutes <= 9 * 60 + 30
  } catch {
    return false
  }
}

function matchSetupName(trade: Trade): string | null {
  const raw = `${trade.setup_tag ?? ''} ${trade.trade_setup ?? ''}`.toLowerCase().trim()
  if (!raw) return null
  if (raw.includes('orb')) return 'ORB Break'
  if (raw.includes('ttm') || raw.includes('squeeze')) return 'TTM Squeeze'
  if (raw.includes('avwap') || (raw.includes('vwap') && raw.includes('bounce'))) return 'AVWAP Bounce'
  if (raw.includes('fvg') || raw.includes('fair value')) return 'FVG Bounce'
  if (raw.includes('divergence') || raw.includes('trendline')) return 'Divergence/TB'
  return null
}

function ctTotalMins(entryTime: string): number | null {
  try {
    const d = new Date(entryTime)
    const s = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: false, hour: '2-digit', minute: '2-digit' })
    const [h, m] = s.split(':').map(Number)
    return h * 60 + m
  } catch { return null }
}

function timeWindowLabel(mins: number): string {
  if (mins >= 525 && mins <= 570) return 'Primary'
  if (mins > 570 && mins <= 630) return 'Contd.'
  if (mins > 630 && mins <= 660) return 'Late'
  if (mins >= 750 && mins <= 840) return 'Secondary'
  return 'Other'
}

interface SimItem {
  trade: Trade
  pnl: number
}

interface SimStats {
  total: number
  winRate: number
  netPnL: number
  profitFactor: number
  avgRMultiple: number | null
}

function applyScenarios(
  trades: Trade[],
  scenarios: Set<ScenarioId>,
  defaultRisk: number,
): SimItem[] {
  let result: SimItem[] = trades.map((t) => ({ trade: t, pnl: t.net_pnl }))

  if (scenarios.has('no-c-grade')) result = result.filter(({ trade }) => trade.grade !== 'C')
  if (scenarios.has('primary-window'))
    result = result.filter(({ trade }) => isInPrimaryWindow(trade.entry_time))
  if (scenarios.has('no-emotional')) {
    const emotional = new Set(['fomo', 'FOMO', 'revenge', 'anxious', 'overconfident'])
    result = result.filter(({ trade }) => !emotional.has(trade.mood ?? ''))
  }
  if (scenarios.has('orb-only')) {
    result = result.filter(
      ({ trade }) =>
        (trade.setup_tag ?? '').toLowerCase().includes('orb') ||
        (trade.trade_setup ?? '').toLowerCase().includes('orb'),
    )
  }
  if (scenarios.has('bull-bias'))
    result = result.filter(({ trade }) => trade.trade_bias === 'Bull')
  if (scenarios.has('a-grade-only'))
    result = result.filter(({ trade }) => trade.grade === 'A')
  if (scenarios.has('cap-1r') && defaultRisk > 0) {
    result = result.map(({ trade, pnl }) => ({
      trade,
      pnl: pnl < 0 ? Math.max(pnl, -defaultRisk) : pnl,
    }))
  }

  return result
}

function calcStats(items: SimItem[]): SimStats | null {
  if (!items.length) return null
  const winners = items.filter(({ pnl }) => pnl > 0)
  const losers = items.filter(({ pnl }) => pnl < 0)
  const netPnL = items.reduce((s, { pnl }) => s + pnl, 0)
  const grossWins = winners.reduce((s, { pnl }) => s + pnl, 0)
  const grossLosses = Math.abs(losers.reduce((s, { pnl }) => s + pnl, 0))
  const profitFactor =
    grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0

  const rItems = items.filter(({ trade }) => trade.stop_loss !== null)
  const rValues = rItems
    .map(({ trade, pnl }) => {
      const riskPts = Math.abs(trade.entry_price - trade.stop_loss!)
      if (riskPts === 0) return null
      const ptVal = POINT_VALUES[trade.instrument || 'ES'] ?? 50
      const oneRDollar = riskPts * trade.quantity * ptVal
      return pnl / oneRDollar
    })
    .filter((r): r is number => r !== null)

  return {
    total: items.length,
    winRate: (winners.length / items.length) * 100,
    netPnL,
    profitFactor,
    avgRMultiple: rValues.length
      ? rValues.reduce((s, r) => s + r, 0) / rValues.length
      : null,
  }
}

function fmtPF(pf: number): string {
  if (!isFinite(pf)) return '∞'
  return pf.toFixed(2)
}

function diffColor(val: number, higherIsBetter = true): string {
  if (val === 0) return 'text-gray-400'
  return (higherIsBetter ? val > 0 : val < 0) ? 'text-emerald-400' : 'text-red-400'
}

// ──────────────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [trades, setTrades] = useState<Trade[]>([])
  const [riskRules, setRiskRules] = useState<RiskRules | null>(null)
  const [loading, setLoading] = useState(true)
const [matrixDim, setMatrixDim] = useState<MatrixDim>('time')

  // What-If state
  const [dateRange, setDateRange] = useState<DateRange>('all-time')
  const [activeScenarios, setActiveScenarios] = useState<Set<ScenarioId>>(new Set())
  const [whatIfInsight, setWhatIfInsight] = useState<string | null>(null)
  const [loadingInsight, setLoadingInsight] = useState(false)

  const supabase = createClient()

  const loadTrades = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: tradesData }, { data: rr }] = await Promise.all([
      supabase
        .from('trades')
        .select('*')
        .eq('user_id', user.id)
        .order('entry_time', { ascending: true }),
      supabase.from('risk_rules').select('*').eq('user_id', user.id).single(),
    ])
    setTrades((tradesData as Trade[]) || [])
    if (rr) setRiskRules(rr as RiskRules)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadTrades()
  }, [loadTrades])

  function toggleScenario(id: ScenarioId) {
    setActiveScenarios((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setWhatIfInsight(null)
  }

  // Hourly P&L data
  const hourlyData = useMemo(() => {
    const map = new Map<number, number[]>()
    for (const t of trades) {
      const h = getHours(parseISO(t.entry_time))
      if (!map.has(h)) map.set(h, [])
      map.get(h)!.push(t.net_pnl)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, pnls]) => ({
        label: hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`,
        avg: pnls.reduce((a, b) => a + b, 0) / pnls.length,
        count: pnls.length,
      }))
  }, [trades])

  // R-Multiple distribution
  const rMultipleData = useMemo(() => {
    const tradesWithR = trades.filter((t) => t.stop_loss !== null && t.entry_price !== null)
    const rValues = tradesWithR.map((t) => {
      const riskPts = Math.abs(t.entry_price - t.stop_loss!)
      const pnlPts = (t.exit_price - t.entry_price) * (t.direction === 'long' ? 1 : -1)
      return riskPts > 0 ? pnlPts / riskPts : 0
    })

    const bins = new Map<string, number>()
    const binEdges = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
    for (const edge of binEdges) bins.set(`${edge}R`, 0)

    for (const r of rValues) {
      const rounded = Math.round(Math.max(-4, Math.min(4, r)))
      const key = `${rounded}R`
      bins.set(key, (bins.get(key) || 0) + 1)
    }

    return Array.from(bins.entries()).map(([label, count]) => ({ label, count }))
  }, [trades])

  // MAE/MFE scatter
  const maeMfeData = useMemo(() => {
    return trades
      .filter((t) => t.mae !== null && t.mfe !== null)
      .map((t) => ({
        mae: Math.abs(t.mae!),
        mfe: t.mfe!,
        pnl: t.net_pnl,
        win: t.net_pnl > 0,
      }))
  }, [trades])

  // Drawdown
  const drawdownData = useMemo(() => {
    if (!trades.length) return []
    let peak = 0
    let cumulative = 0
    return trades.map((t) => {
      cumulative += t.net_pnl
      if (cumulative > peak) peak = cumulative
      const dd = peak > 0 ? ((cumulative - peak) / peak) * 100 : 0
      return {
        date: format(parseISO(t.entry_time), 'MM/dd'),
        drawdown: Math.round(dd * 10) / 10,
        cumulative,
      }
    })
  }, [trades])

  // Direction stats
  const directionData = useMemo(() => {
    const longs = trades.filter((t) => t.direction === 'long')
    const shorts = trades.filter((t) => t.direction === 'short')

    const stats = (arr: Trade[]) => {
      if (!arr.length) return { winRate: 0, avgPnL: 0, count: 0 }
      const winners = arr.filter((t) => t.net_pnl > 0)
      return {
        winRate: (winners.length / arr.length) * 100,
        avgPnL: arr.reduce((s, t) => s + t.net_pnl, 0) / arr.length,
        count: arr.length,
      }
    }

    const longStats = stats(longs)
    const shortStats = stats(shorts)

    return [
      { name: 'Long', winRate: longStats.winRate, avgPnL: longStats.avgPnL, count: longStats.count },
      { name: 'Short', winRate: shortStats.winRate, avgPnL: shortStats.avgPnL, count: shortStats.count },
    ]
  }, [trades])

  // Emotion stacked data
  const emotionData = useMemo(() => {
    const moods = ['calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident']
    return moods
      .filter((m) => trades.some((t) => t.mood === m))
      .map((mood) => {
        const moodTrades = trades.filter((t) => t.mood === mood)
        const wins = moodTrades.filter((t) => t.net_pnl > 0)
        const losses = moodTrades.filter((t) => t.net_pnl <= 0)
        const totalWins = wins.reduce((s, t) => s + t.net_pnl, 0)
        const totalLosses = losses.reduce((s, t) => s + t.net_pnl, 0)
        return { mood, totalWins, totalLosses: Math.abs(totalLosses), count: moodTrades.length }
      })
  }, [trades])

  // Overview stats
  const overviewStats = useMemo(() => {
    if (!trades.length) return null
    const winners = trades.filter((t) => t.net_pnl > 0)
    const losers = trades.filter((t) => t.net_pnl < 0)
    const totalPnL = trades.reduce((s, t) => s + t.net_pnl, 0)
    const avgWin = winners.length ? winners.reduce((s, t) => s + t.net_pnl, 0) / winners.length : 0
    const avgLoss = losers.length ? Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0) / losers.length) : 0
    const grossWins = winners.reduce((s, t) => s + t.net_pnl, 0)
    const grossLosses = Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0))
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : Infinity
    const maxDrawdown = drawdownData.length ? Math.min(...drawdownData.map((d) => d.drawdown)) : 0
    const bestTrade = trades.reduce((b, t) => (t.net_pnl > b.net_pnl ? t : b), trades[0])
    const worstTrade = trades.reduce((w, t) => (t.net_pnl < w.net_pnl ? t : w), trades[0])

    return {
      totalPnL, winners: winners.length, losers: losers.length, total: trades.length,
      winRate: (winners.length / trades.length) * 100, avgWin, avgLoss, profitFactor,
      maxDrawdown, bestTrade, worstTrade,
    }
  }, [trades, drawdownData])

  // ── What-If computed values ──────────────────────────────────────────────────

  const dateFilteredTrades = useMemo(() => {
    if (dateRange === 'all-time') return trades
    const now = new Date()
    let start: Date
    switch (dateRange) {
      case 'this-week':
        start = startOfWeek(now, { weekStartsOn: 1 })
        break
      case 'this-month':
        start = startOfMonth(now)
        break
      case 'last-30':
        start = subDays(now, 30)
        break
      default:
        return trades
    }
    return trades.filter((t) => parseISO(t.date).getTime() >= start.getTime())
  }, [trades, dateRange])

  const whatIfResult = useMemo(() => {
    const actualItems: SimItem[] = dateFilteredTrades.map((t) => ({ trade: t, pnl: t.net_pnl }))
    const simulatedItems = applyScenarios(
      dateFilteredTrades,
      activeScenarios,
      riskRules?.default_risk ?? 100,
    )
    return {
      actual: calcStats(actualItems),
      simulated: calcStats(simulatedItems),
    }
  }, [dateFilteredTrades, activeScenarios, riskRules])

  async function handleGetInsight() {
    const { actual, simulated } = whatIfResult
    if (!actual || !simulated || activeScenarios.size === 0) return
    setLoadingInsight(true)
    try {
      const diff = simulated.netPnL - actual.netPnL
      const pct = actual.netPnL !== 0 ? (diff / Math.abs(actual.netPnL)) * 100 : 0
      const scenarioLabels = Array.from(activeScenarios).map(
        (id) => WHATIF_SCENARIOS.find((s) => s.id === id)?.label ?? id,
      )
      const res = await fetch('/api/claude/whatif-insight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actual,
          simulated,
          scenarios: scenarioLabels,
          dollarDifference: diff,
          percentChange: pct,
        }),
      })
      const data = await res.json()
      if (data.insight) setWhatIfInsight(data.insight)
      else toast.error('Failed to get AI insight')
    } catch {
      toast.error('Failed to get AI insight')
    } finally {
      setLoadingInsight(false)
    }
  }


  // ── Setup Performance Matrix ──────────────────────────────────────────────
  const setupMatrixData = useMemo(() => {
    const SETUP_KEYS = ['ORB Break', 'TTM Squeeze', 'AVWAP Bounce', 'FVG Bounce', 'Divergence/TB'] as const
    const TIME_COLS = ['Primary', 'Contd.', 'Late', 'Secondary', 'Other'] as const
    const DAY_COLS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const
    const BIAS_COLS = ['Bull', 'Bear', 'Neutral', '—'] as const

    type Cell = { n: number; wins: number; pnl: number; grossW: number; grossL: number }
    const mk = (): Cell => ({ n: 0, wins: 0, pnl: 0, grossW: 0, grossL: 0 })
    const add = (cell: Cell, t: Trade) => {
      cell.n++
      if (t.net_pnl > 0) { cell.wins++; cell.grossW += t.net_pnl } else { cell.grossL += Math.abs(t.net_pnl) }
      cell.pnl += t.net_pnl
    }

    const overall = Object.fromEntries(SETUP_KEYS.map(s => [s, mk()])) as Record<string, Cell>
    const timeM = Object.fromEntries(SETUP_KEYS.map(s => [s, Object.fromEntries(TIME_COLS.map(c => [c, mk()]))])) as Record<string, Record<string, Cell>>
    const dayM = Object.fromEntries(SETUP_KEYS.map(s => [s, Object.fromEntries(DAY_COLS.map(c => [c, mk()]))])) as Record<string, Record<string, Cell>>
    const biasM = Object.fromEntries(SETUP_KEYS.map(s => [s, Object.fromEntries(BIAS_COLS.map(c => [c, mk()]))])) as Record<string, Record<string, Cell>>

    for (const t of trades) {
      const setup = matchSetupName(t)
      if (!setup) continue
      add(overall[setup], t)
      const mins = ctTotalMins(t.entry_time)
      if (mins !== null) add(timeM[setup][timeWindowLabel(mins)], t)
      try {
        const day = format(parseISO(t.date), 'eee') as typeof DAY_COLS[number]
        if (dayM[setup][day]) add(dayM[setup][day], t)
      } catch {}
      const bk = (t.trade_bias ?? '—') as typeof BIAS_COLS[number]
      if (biasM[setup][bk]) add(biasM[setup][bk], t)
    }

    const totalTagged = Object.values(overall).reduce((s, c) => s + c.n, 0)
    return { SETUP_KEYS, TIME_COLS, DAY_COLS, BIAS_COLS, overall, timeM, dayM, biasM, totalTagged }
  }, [trades])

  // ── Day of Week ───────────────────────────────────────────────────────────
  const dayOfWeekData = useMemo(() => {
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const
    type DayCell = { pnls: number[]; wins: number }
    const map: Record<string, DayCell> = Object.fromEntries(DAYS.map(d => [d, { pnls: [], wins: 0 }]))
    for (const t of trades) {
      try {
        const day = format(parseISO(t.date), 'eee')
        if (map[day]) {
          map[day].pnls.push(t.net_pnl)
          if (t.net_pnl > 0) map[day].wins++
        }
      } catch {}
    }
    return DAYS.map(day => {
      const { pnls, wins } = map[day]
      const n = pnls.length
      const avg = n > 0 ? pnls.reduce((a, b) => a + b, 0) / n : 0
      const total = pnls.reduce((a, b) => a + b, 0)
      const winRate = n > 0 ? (wins / n) * 100 : 0
      return { day, n, avg, total, winRate }
    })
  }, [trades])

  // ── Emotion × Grade matrix ────────────────────────────────────────────────
  const emotionGradeData = useMemo(() => {
    const MOODS = ['calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident'] as const
    const GRADES = ['A', 'B', 'C'] as const
    type EGCell = { n: number; wins: number; pnl: number }
    const mk = (): EGCell => ({ n: 0, wins: 0, pnl: 0 })
    const matrix: Record<string, Record<string, EGCell>> = Object.fromEntries(
      GRADES.map(g => [g, Object.fromEntries(MOODS.map(m => [m, mk()]))])
    )
    // Grade-only totals (regardless of mood)
    const byGrade: Record<string, EGCell> = Object.fromEntries(GRADES.map(g => [g, mk()]))
    // Mood-only totals (regardless of grade)
    const byMood: Record<string, EGCell> = Object.fromEntries(MOODS.map(m => [m, mk()]))

    let untagged = 0
    for (const t of trades) {
      const hasMood = !!t.mood
      const hasGrade = !!t.grade
      if (!hasMood || !hasGrade) { if (!hasMood && !hasGrade) untagged++; }
      const addTo = (cell: EGCell) => {
        cell.n++
        if (t.net_pnl > 0) cell.wins++
        cell.pnl += t.net_pnl
      }
      if (hasMood && hasGrade) {
        const cell = matrix[t.grade!]?.[t.mood!]
        if (cell) addTo(cell)
      }
      if (hasGrade) { const c = byGrade[t.grade!]; if (c) addTo(c) }
      if (hasMood) { const c = byMood[t.mood!]; if (c) addTo(c) }
    }
    return { matrix, MOODS, GRADES, byGrade, byMood, untagged }
  }, [trades])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading reports...
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reports & Analytics</h1>
        <p className="text-sm text-gray-400 mt-1">{trades.length} trades analyzed</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-xl p-1 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition',
              tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {overviewStats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total P&L', value: formatCurrency(overviewStats.totalPnL), color: overviewStats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'Win Rate', value: `${overviewStats.winRate.toFixed(1)}%` },
                  { label: 'Profit Factor', value: overviewStats.profitFactor === Infinity ? '∞' : overviewStats.profitFactor.toFixed(2), color: overviewStats.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-yellow-400' },
                  { label: 'Max Drawdown', value: `${overviewStats.maxDrawdown.toFixed(1)}%`, color: 'text-red-400' },
                  { label: 'Avg Win', value: formatCurrency(overviewStats.avgWin), color: 'text-emerald-400' },
                  { label: 'Avg Loss', value: formatCurrency(-overviewStats.avgLoss), color: 'text-red-400' },
                  { label: 'Total Trades', value: overviewStats.total.toString() },
                  { label: 'Win/Loss', value: `${overviewStats.winners}W / ${overviewStats.losers}L` },
                ].map((stat) => (
                  <div key={stat.label} className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
                    <p className="text-xs text-gray-400 font-medium">{stat.label}</p>
                    <p className={cn('text-xl font-bold mt-1', stat.color || 'text-white')}>{stat.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                  <p className="text-xs text-emerald-400 font-medium mb-2">Best Trade</p>
                  <p className="text-2xl font-bold text-emerald-400">{formatCurrency(overviewStats.bestTrade.net_pnl)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(parseISO(overviewStats.bestTrade.date), 'MMM d, yyyy')} — {overviewStats.bestTrade.direction.toUpperCase()} {overviewStats.bestTrade.quantity}ct @ {overviewStats.bestTrade.entry_price}
                  </p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                  <p className="text-xs text-red-400 font-medium mb-2">Worst Trade</p>
                  <p className="text-2xl font-bold text-red-400">{formatCurrency(overviewStats.worstTrade.net_pnl)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(parseISO(overviewStats.worstTrade.date), 'MMM d, yyyy')} — {overviewStats.worstTrade.direction.toUpperCase()} {overviewStats.worstTrade.quantity}ct @ {overviewStats.worstTrade.entry_price}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <EmptyState message="No trades yet — import trades to see reports" />
          )}
        </div>
      )}

      {/* Hourly P&L */}
      {tab === 'hourly' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Average P&L by Hour of Day</h3>
          {hourlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={hourlyData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <ReferenceLine y={0} stroke="#4b5563" />
                <Tooltip {...tooltipStyle} formatter={(v) => [formatCurrency(Number(v)), 'Avg P&L']} />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                  {hourlyData.map((entry, i) => (
                    <Cell key={i} fill={entry.avg >= 0 ? '#34d399' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No trade data available" />
          )}
        </div>
      )}

      {/* R-Multiple */}
      {tab === 'rmultiple' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">R-Multiple Distribution</h3>
          <p className="text-xs text-gray-500 mb-4">Requires stop_loss to be set on trades</p>
          {rMultipleData.some((d) => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={rMultipleData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v) => [Number(v), 'Trades']} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {rMultipleData.map((entry, i) => {
                    const rVal = parseInt(entry.label)
                    return <Cell key={i} fill={rVal >= 0 ? '#34d399' : '#f87171'} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No trades with stop_loss set — annotate trades to see R-multiple distribution" />
          )}
        </div>
      )}

      {/* MAE/MFE Scatter */}
      {tab === 'maemfe' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-1">MAE vs MFE Analysis</h3>
          <p className="text-xs text-gray-500 mb-4">Max Adverse Excursion vs Max Favorable Excursion per trade</p>
          {maeMfeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="mae"
                  name="MAE (pts)"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'MAE (pts)', position: 'bottom', fill: '#6b7280', fontSize: 11 }}
                />
                <YAxis
                  dataKey="mfe"
                  name="MFE (pts)"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'MFE (pts)', angle: -90, position: 'left', fill: '#6b7280', fontSize: 11 }}
                />
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value, name) => [Number(value).toFixed(2), String(name)]}
                />
                <Scatter name="Winners" data={maeMfeData.filter((d) => d.win)} fill="#34d399" opacity={0.7} />
                <Scatter name="Losers" data={maeMfeData.filter((d) => !d.win)} fill="#f87171" opacity={0.7} />
                <Legend />
              </ScatterChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No trades with MAE/MFE data — annotate trades to see this chart" />
          )}
        </div>
      )}

      {/* Drawdown */}
      {tab === 'drawdown' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Running Drawdown from Peak Equity</h3>
          {drawdownData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={drawdownData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                <ReferenceLine y={0} stroke="#4b5563" />
                <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Drawdown']} />
                <Area type="monotone" dataKey="drawdown" stroke="#f87171" strokeWidth={2} fill="url(#ddGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No trade data available" />
          )}
        </div>
      )}

      {/* Direction */}
      {tab === 'direction' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Win Rate by Direction</h3>
            {directionData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={directionData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Win Rate']} />
                  <Bar dataKey="winRate" radius={[6, 6, 0, 0]}>
                    {directionData.map((entry, i) => (
                      <Cell key={i} fill={entry.name === 'Long' ? '#34d399' : '#f87171'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No data" />
            )}
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Avg P&L by Direction</h3>
            {directionData.some((d) => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={directionData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <ReferenceLine y={0} stroke="#4b5563" />
                  <Tooltip {...tooltipStyle} formatter={(v) => [formatCurrency(Number(v)), 'Avg P&L']} />
                  <Bar dataKey="avgPnL" radius={[6, 6, 0, 0]}>
                    {directionData.map((entry, i) => (
                      <Cell key={i} fill={entry.avgPnL >= 0 ? '#34d399' : '#f87171'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No data" />
            )}
          </div>

          <div className="md:col-span-2 bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400">Direction</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Trades</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Win Rate</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Avg P&L</th>
                </tr>
              </thead>
              <tbody>
                {directionData.map((d) => (
                  <tr key={d.name} className="border-b border-gray-700/30">
                    <td className="px-5 py-3 font-medium" style={{ color: d.name === 'Long' ? '#34d399' : '#f87171' }}>{d.name}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{d.count}</td>
                    <td className="px-5 py-3 text-right text-gray-300">{d.winRate.toFixed(1)}%</td>
                    <td className={cn('px-5 py-3 text-right font-semibold', d.avgPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {formatCurrency(d.avgPnL)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Emotion */}
      {tab === 'emotion' && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4">P&L by Mood (Wins vs Losses)</h3>
          {emotionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={emotionData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                <XAxis dataKey="mood" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip {...tooltipStyle} formatter={(v, name) => [formatCurrency(Number(v)), name === 'totalWins' ? 'Total Wins' : 'Total Losses']} />
                <Legend formatter={(value) => value === 'totalWins' ? 'Wins' : 'Losses'} />
                <Bar dataKey="totalWins" fill="#34d399" radius={[4, 4, 0, 0]} name="totalWins" />
                <Bar dataKey="totalLosses" fill="#f87171" radius={[4, 4, 0, 0]} name="totalLosses" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No mood-tagged trades yet — annotate trades to see emotion breakdown" />
          )}
        </div>
      )}

      {/* ── What-If Simulator ───────────────────────────────────────────────── */}
      {tab === 'whatif' && (
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h2 className="text-base font-semibold text-white">What-If Simulator</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Replay your trade history under different rules. Toggles are applied simultaneously — no data is stored.
            </p>
          </div>

          {trades.length === 0 ? (
            <EmptyState message="No trades to simulate — import trades first" />
          ) : (
            <>
              {/* Date range */}
              <div className="flex gap-2 flex-wrap">
                {DATE_RANGES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => {
                      setDateRange(r.id)
                      setWhatIfInsight(null)
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition border',
                      dateRange === r.id
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-800/50 border-gray-700/50 text-gray-400 hover:text-white hover:border-gray-600',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
                <span className="self-center text-xs text-gray-600 ml-1">
                  {dateFilteredTrades.length} trade{dateFilteredTrades.length !== 1 ? 's' : ''} in range
                </span>
              </div>

              {/* Scenario toggles */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Scenarios — select any combination
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {WHATIF_SCENARIOS.map((s) => {
                    const active = activeScenarios.has(s.id)
                    return (
                      <button
                        key={s.id}
                        onClick={() => toggleScenario(s.id)}
                        className={cn(
                          'flex items-start gap-3 rounded-xl p-3 border text-left transition',
                          active
                            ? 'bg-blue-600/10 border-blue-500/50'
                            : 'bg-gray-900/40 border-gray-700/40 hover:border-gray-600',
                        )}
                      >
                        <div
                          className={cn(
                            'mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition',
                            active ? 'bg-blue-600 border-blue-600' : 'border-gray-600',
                          )}
                        >
                          {active && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
                              <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className={cn('text-sm font-medium', active ? 'text-white' : 'text-gray-300')}>
                            {s.label}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>
                          {s.id === 'cap-1r' && (
                            <p className="text-xs text-blue-400/70 mt-0.5">
                              Default risk: {formatCurrency(riskRules?.default_risk ?? 100)}
                            </p>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Results comparison */}
              {(() => {
                const { actual, simulated } = whatIfResult
                if (!actual) return <EmptyState message="No trades in selected date range" />

                const noScenarios = activeScenarios.size === 0
                const sim = noScenarios ? actual : simulated
                const pnlDiff = sim ? sim.netPnL - actual.netPnL : 0
                const pctDiff = actual.netPnL !== 0 ? (pnlDiff / Math.abs(actual.netPnL)) * 100 : 0
                const wrDiff = sim ? sim.winRate - actual.winRate : 0
                const pfDiff = sim && isFinite(sim.profitFactor) && isFinite(actual.profitFactor)
                  ? sim.profitFactor - actual.profitFactor
                  : null
                const rDiff = sim?.avgRMultiple != null && actual.avgRMultiple != null
                  ? sim.avgRMultiple - actual.avgRMultiple
                  : null
                const countDiff = sim ? sim.total - actual.total : 0

                const summaryText = noScenarios
                  ? 'Select at least one scenario above to see simulated results.'
                  : pnlDiff === 0
                  ? 'No change in net P&L under these conditions.'
                  : (() => {
                      const scenarioNames = Array.from(activeScenarios)
                        .map((id) => WHATIF_SCENARIOS.find((s) => s.id === id)?.label ?? id)
                      const text = scenarioNames.length === 1
                        ? scenarioNames[0]
                        : scenarioNames.slice(0, -1).join(', ') + ' & ' + scenarioNames[scenarioNames.length - 1]
                      return pnlDiff > 0
                        ? `${text} would have added ${formatCurrency(pnlDiff)} (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}%).`
                        : `${text} would have reduced P&L by ${formatCurrency(Math.abs(pnlDiff))} (${pctDiff.toFixed(1)}%).`
                    })()

                const rows: {
                  label: string
                  actualVal: string
                  simVal: string | null
                  diffVal: string | null
                  diffColor: string
                }[] = [
                  {
                    label: 'Trade Count',
                    actualVal: actual.total.toString(),
                    simVal: sim ? sim.total.toString() : null,
                    diffVal: sim ? (countDiff >= 0 ? `+${countDiff}` : `${countDiff}`) : null,
                    diffColor: countDiff === 0 ? 'text-gray-400' : 'text-gray-300',
                  },
                  {
                    label: 'Win Rate',
                    actualVal: `${actual.winRate.toFixed(1)}%`,
                    simVal: sim ? `${sim.winRate.toFixed(1)}%` : null,
                    diffVal: sim ? `${wrDiff >= 0 ? '+' : ''}${wrDiff.toFixed(1)}%` : null,
                    diffColor: diffColor(wrDiff),
                  },
                  {
                    label: 'Net P&L',
                    actualVal: formatCurrency(actual.netPnL),
                    simVal: sim ? formatCurrency(sim.netPnL) : null,
                    diffVal: sim ? `${pnlDiff >= 0 ? '+' : ''}${formatCurrency(pnlDiff)}` : null,
                    diffColor: diffColor(pnlDiff),
                  },
                  {
                    label: 'Profit Factor',
                    actualVal: fmtPF(actual.profitFactor),
                    simVal: sim ? fmtPF(sim.profitFactor) : null,
                    diffVal: pfDiff !== null ? `${pfDiff >= 0 ? '+' : ''}${pfDiff.toFixed(2)}` : (sim ? '—' : null),
                    diffColor: pfDiff !== null ? diffColor(pfDiff) : 'text-gray-400',
                  },
                  {
                    label: 'Avg R-Multiple',
                    actualVal: actual.avgRMultiple != null ? `${actual.avgRMultiple.toFixed(2)}R` : '—',
                    simVal: sim
                      ? sim.avgRMultiple != null ? `${sim.avgRMultiple.toFixed(2)}R` : '—'
                      : null,
                    diffVal: rDiff !== null ? `${rDiff >= 0 ? '+' : ''}${rDiff.toFixed(2)}R` : (sim ? '—' : null),
                    diffColor: rDiff !== null ? diffColor(rDiff) : 'text-gray-400',
                  },
                ]

                return (
                  <div className="space-y-3">
                    {/* Comparison table */}
                    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
                      <div className="grid grid-cols-4 border-b border-gray-700/50">
                        <div className="px-5 py-3 text-xs font-semibold text-gray-400">Metric</div>
                        <div className="px-5 py-3 text-xs font-semibold text-gray-400 text-right">Actual</div>
                        <div className="px-5 py-3 text-xs font-semibold text-blue-400 text-right">Simulated</div>
                        <div className="px-5 py-3 text-xs font-semibold text-gray-400 text-right">Difference</div>
                      </div>
                      {rows.map((row) => (
                        <div key={row.label} className="grid grid-cols-4 border-b border-gray-700/20 hover:bg-gray-700/10 transition">
                          <div className="px-5 py-3 text-sm text-gray-300">{row.label}</div>
                          <div className="px-5 py-3 text-sm text-gray-200 text-right font-medium">{row.actualVal}</div>
                          <div className={cn('px-5 py-3 text-sm text-right font-semibold', noScenarios ? 'text-gray-500' : 'text-blue-300')}>
                            {row.simVal ?? '—'}
                          </div>
                          <div className={cn('px-5 py-3 text-sm text-right font-semibold', row.diffColor)}>
                            {row.diffVal ?? '—'}
                          </div>
                        </div>
                      ))}

                      {/* Summary row */}
                      <div className="px-5 py-4 bg-gray-900/40">
                        <p className="text-sm text-gray-300">{summaryText}</p>
                        {!noScenarios && sim && (
                          <div className="flex gap-4 mt-2">
                            <span className={cn('text-xs font-semibold', diffColor(pnlDiff))}>
                              {pnlDiff >= 0 ? '+' : ''}{formatCurrency(pnlDiff)}
                            </span>
                            <span className={cn('text-xs', diffColor(pctDiff))}>
                              {pctDiff >= 0 ? '+' : ''}{pctDiff.toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* AI Insight */}
                    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-200">AI Insight</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Send this comparison to Claude for a behavioral analysis.
                          </p>
                        </div>
                        <button
                          onClick={handleGetInsight}
                          disabled={loadingInsight || noScenarios || !sim}
                          className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition',
                            noScenarios || !sim
                              ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                              : 'bg-purple-600 hover:bg-purple-500 text-white',
                          )}
                        >
                          {loadingInsight ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                          {loadingInsight ? 'Analyzing…' : whatIfInsight ? 'Refresh Insight' : 'Get AI Insight'}
                        </button>
                      </div>

                      {whatIfInsight && (
                        <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4">
                          <p className="text-sm text-gray-200 leading-relaxed">{whatIfInsight}</p>
                        </div>
                      )}

                      {noScenarios && !whatIfInsight && (
                        <p className="text-xs text-gray-600">Enable at least one scenario to unlock AI Insight.</p>
                      )}
                    </div>
                  </div>
                )
              })()}
            </>
          )}

          <p className="text-xs text-gray-700">
            Scenarios are hypothetical and client-side only. No data is written. R-multiple uses per-instrument point values (ES $50, NQ $20, MES $5, MNQ $2).
          </p>
        </div>
      )}

      {/* Monte Carlo Simulator */}
      {tab === 'montecarlo' && (
        <MonteCarloTab trades={dateFilteredTrades} riskRules={riskRules} />
      )}

      {/* ── Setup Performance Matrix ──────────────────────────────────────── */}
      {tab === 'setups' && (() => {
        const { SETUP_KEYS, TIME_COLS, DAY_COLS, BIAS_COLS, overall, timeM, dayM, biasM, totalTagged } = setupMatrixData

        const dimCols = matrixDim === 'time' ? TIME_COLS : matrixDim === 'day' ? DAY_COLS : BIAS_COLS
        const dimMatrix = matrixDim === 'time' ? timeM : matrixDim === 'day' ? dayM : biasM

        const cellColor = (n: number, wins: number) => {
          if (n === 0) return 'text-gray-700'
          const wr = wins / n
          if (n < 3) return 'text-gray-500'
          if (wr >= 0.60) return 'text-emerald-400'
          if (wr >= 0.45) return 'text-yellow-400'
          return 'text-red-400'
        }
        const cellBg = (n: number, wins: number) => {
          if (n < 3) return ''
          const wr = wins / n
          if (wr >= 0.60) return 'bg-emerald-500/10'
          if (wr >= 0.45) return 'bg-yellow-500/10'
          return 'bg-red-500/10'
        }

        const summaryData = SETUP_KEYS.map(s => {
          const c = overall[s]
          return {
            name: s,
            n: c.n,
            winRate: c.n > 0 ? (c.wins / c.n) * 100 : 0,
            avgPnL: c.n > 0 ? c.pnl / c.n : 0,
            pf: c.grossL > 0 ? c.grossW / c.grossL : c.grossW > 0 ? Infinity : 0,
            totalPnL: c.pnl,
          }
        }).sort((a, b) => b.totalPnL - a.totalPnL)

        const timeCOL_LABELS: Record<string, string> = {
          Primary: 'Primary (08:45–09:30)',
          'Contd.': 'Contd. (09:30–10:30)',
          Late: 'Late (10:30–11:00)',
          Secondary: 'Secondary (12:30–14:00)',
          Other: 'Other',
        }

        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-white">Setup Performance Matrix</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                Empirical data from your {totalTagged} tagged live trades. Cells with n&lt;3 are dimmed — too small to conclude from.
              </p>
            </div>

            {totalTagged === 0 ? (
              <EmptyState message="No setup-tagged trades yet — annotate trades with a setup_tag or trade_setup to populate this matrix" />
            ) : (
              <>
                {/* Overall summary table */}
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-700/50">
                    <p className="text-sm font-semibold text-gray-200">Overall by Setup — ranked by Net P&L</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-700/40">
                        <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-400">Setup</th>
                        <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-400">Trades</th>
                        <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-400">Win Rate</th>
                        <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-400">Avg P&L</th>
                        <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-400">Profit Factor</th>
                        <th className="text-right px-5 py-2.5 text-xs font-semibold text-gray-400">Net P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaryData.map((s, i) => (
                        <tr key={s.name} className="border-b border-gray-700/20 hover:bg-gray-700/10 transition">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600 w-4 tabular-nums">{i + 1}</span>
                              <span className="font-medium text-gray-200">{s.name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right text-gray-400 tabular-nums">{s.n}</td>
                          <td className="px-5 py-3 text-right">
                            {s.n > 0 ? (
                              <span className={cn('font-semibold', s.winRate >= 55 ? 'text-emerald-400' : s.winRate >= 45 ? 'text-yellow-400' : 'text-red-400')}>
                                {s.winRate.toFixed(1)}%
                              </span>
                            ) : <span className="text-gray-600">—</span>}
                          </td>
                          <td className={cn('px-5 py-3 text-right font-semibold tabular-nums', s.avgPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {s.n > 0 ? formatCurrency(s.avgPnL) : '—'}
                          </td>
                          <td className="px-5 py-3 text-right text-gray-300 tabular-nums">
                            {s.n > 0 ? (isFinite(s.pf) ? s.pf.toFixed(2) : '∞') : '—'}
                          </td>
                          <td className={cn('px-5 py-3 text-right font-semibold tabular-nums', s.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {s.n > 0 ? formatCurrency(s.totalPnL) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Win rate matrix */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-200">Win Rate Matrix</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {matrixDim === 'time' && 'Which setups work in which CT time windows?'}
                        {matrixDim === 'day' && 'Which setups work on which days of the week?'}
                        {matrixDim === 'bias' && 'Which setups perform under each market bias?'}
                      </p>
                    </div>
                    <div className="flex gap-1 bg-gray-800/50 border border-gray-700/50 rounded-lg p-1">
                      {([
                        { id: 'time', label: 'Time Window' },
                        { id: 'day', label: 'Day of Week' },
                        { id: 'bias', label: 'Market Bias' },
                      ] as const).map(d => (
                        <button
                          key={d.id}
                          onClick={() => setMatrixDim(d.id)}
                          className={cn(
                            'px-3 py-1.5 rounded text-xs font-medium transition',
                            matrixDim === d.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white',
                          )}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700/50">
                          <th className="text-left px-4 py-3 text-gray-400 font-semibold whitespace-nowrap min-w-[148px]">Setup</th>
                          {dimCols.map(col => (
                            <th
                              key={col}
                              title={matrixDim === 'time' ? timeCOL_LABELS[col] : col}
                              className="px-3 py-3 text-center text-gray-400 font-semibold whitespace-nowrap"
                            >
                              {col}
                            </th>
                          ))}
                          <th className="px-3 py-3 text-center text-gray-500 font-semibold border-l border-gray-700/40">All</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SETUP_KEYS.map(setup => (
                          <tr key={setup} className="border-b border-gray-700/20 hover:bg-gray-700/10 transition">
                            <td className="px-4 py-3 font-medium text-gray-300 whitespace-nowrap">{setup}</td>
                            {dimCols.map(col => {
                              const cell = dimMatrix[setup][col]
                              return (
                                <td key={col} className="px-2 py-2 text-center">
                                  {cell.n === 0 ? (
                                    <span className="text-gray-700">—</span>
                                  ) : (
                                    <div className={cn('rounded px-2 py-1 inline-block min-w-[52px]', cellBg(cell.n, cell.wins))}>
                                      <div className={cn('font-bold', cellColor(cell.n, cell.wins))}>
                                        {(cell.wins / cell.n * 100).toFixed(0)}%
                                      </div>
                                      <div className="text-gray-600 text-[10px]">n={cell.n}</div>
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                            <td className="px-2 py-2 text-center border-l border-gray-700/40">
                              {overall[setup].n === 0 ? (
                                <span className="text-gray-700">—</span>
                              ) : (
                                <div className={cn('rounded px-2 py-1 inline-block min-w-[52px]', cellBg(overall[setup].n, overall[setup].wins))}>
                                  <div className={cn('font-bold', cellColor(overall[setup].n, overall[setup].wins))}>
                                    {(overall[setup].wins / overall[setup].n * 100).toFixed(0)}%
                                  </div>
                                  <div className="text-gray-600 text-[10px]">n={overall[setup].n}</div>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center gap-5 text-[11px] text-gray-500 px-1 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/30 flex-shrink-0" />
                      <span>≥60% win rate</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded bg-yellow-500/10 border border-yellow-500/20 flex-shrink-0" />
                      <span>45–59%</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded bg-red-500/10 border border-red-500/20 flex-shrink-0" />
                      <span>&lt;45%</span>
                    </div>
                    <span className="text-gray-700">Dimmed = n&lt;3 (small sample — don&apos;t conclude)</span>
                    {matrixDim === 'time' && (
                      <span className="text-gray-700 ml-auto">Times shown in CT (Chicago)</span>
                    )}
                  </div>
                </div>

                {/* Avg P&L matrix */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-gray-200">Avg P&L Matrix</p>
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-700/50">
                          <th className="text-left px-4 py-3 text-gray-400 font-semibold whitespace-nowrap min-w-[148px]">Setup</th>
                          {dimCols.map(col => (
                            <th key={col} className="px-3 py-3 text-center text-gray-400 font-semibold whitespace-nowrap">{col}</th>
                          ))}
                          <th className="px-3 py-3 text-center text-gray-500 font-semibold border-l border-gray-700/40">All</th>
                        </tr>
                      </thead>
                      <tbody>
                        {SETUP_KEYS.map(setup => (
                          <tr key={setup} className="border-b border-gray-700/20 hover:bg-gray-700/10 transition">
                            <td className="px-4 py-3 font-medium text-gray-300 whitespace-nowrap">{setup}</td>
                            {dimCols.map(col => {
                              const cell = dimMatrix[setup][col]
                              const avg = cell.n > 0 ? cell.pnl / cell.n : null
                              return (
                                <td key={col} className="px-2 py-2 text-center">
                                  {avg === null ? (
                                    <span className="text-gray-700">—</span>
                                  ) : (
                                    <div className={cn('rounded px-2 py-1 inline-block min-w-[60px]', cell.n >= 3 ? (avg >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10') : '')}>
                                      <div className={cn('font-bold tabular-nums', cell.n < 3 ? 'text-gray-500' : avg >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                        {formatCurrency(avg)}
                                      </div>
                                      <div className="text-gray-600 text-[10px]">n={cell.n}</div>
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                            <td className="px-2 py-2 text-center border-l border-gray-700/40">
                              {overall[setup].n === 0 ? (
                                <span className="text-gray-700">—</span>
                              ) : (() => {
                                const avg = overall[setup].pnl / overall[setup].n
                                return (
                                  <div className={cn('rounded px-2 py-1 inline-block min-w-[60px]', overall[setup].n >= 3 ? (avg >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10') : '')}>
                                    <div className={cn('font-bold tabular-nums', overall[setup].n < 3 ? 'text-gray-500' : avg >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                      {formatCurrency(avg)}
                                    </div>
                                    <div className="text-gray-600 text-[10px]">n={overall[setup].n}</div>
                                  </div>
                                )
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-gray-700 px-1">
                    Avg P&L is net (after commissions). Hover column headers for full time window names.
                  </p>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* ── Day of Week ──────────────────────────────────────────────────────── */}
      {tab === 'dayofweek' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-white">Day of Week Performance</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              Average P&amp;L and win rate broken down by trading day. Reveals chronic weak days before they cost you.
            </p>
          </div>

          {trades.length === 0 ? (
            <EmptyState message="No trades yet — import trades to see day-of-week patterns" />
          ) : (
            <>
              {/* Bar chart */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-200 mb-4">Average Net P&L by Day</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={dayOfWeekData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                    <ReferenceLine y={0} stroke="#4b5563" />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(v, name) => [
                        name === 'avg' ? formatCurrency(Number(v)) : `${Number(v).toFixed(1)}%`,
                        name === 'avg' ? 'Avg P&L' : 'Win Rate',
                      ]}
                    />
                    <Bar dataKey="avg" radius={[6, 6, 0, 0]} name="avg">
                      {dayOfWeekData.map((entry, i) => (
                        <Cell key={i} fill={entry.avg >= 0 ? '#34d399' : '#f87171'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Win rate chart */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-200 mb-4">Win Rate by Day</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dayOfWeekData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                    <ReferenceLine y={50} stroke="#4b5563" strokeDasharray="4 2" />
                    <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Win Rate']} />
                    <Bar dataKey="winRate" radius={[6, 6, 0, 0]} name="winRate">
                      {dayOfWeekData.map((entry, i) => (
                        <Cell key={i} fill={entry.winRate >= 50 ? '#34d399' : '#f87171'} opacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Summary table */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700/50">
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400">Day</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Trades</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Win Rate</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Avg P&L</th>
                      <th className="text-right px-5 py-3 text-xs font-semibold text-gray-400">Net P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayOfWeekData.map((d) => (
                      <tr key={d.day} className="border-b border-gray-700/20 hover:bg-gray-700/10 transition">
                        <td className="px-5 py-3 font-semibold text-gray-200">{d.day}</td>
                        <td className="px-5 py-3 text-right text-gray-400 tabular-nums">{d.n}</td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {d.n > 0 ? (
                            <span className={d.winRate >= 50 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                              {d.winRate.toFixed(1)}%
                            </span>
                          ) : <span className="text-gray-600">—</span>}
                        </td>
                        <td className={cn('px-5 py-3 text-right font-semibold tabular-nums', d.avg >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {d.n > 0 ? formatCurrency(d.avg) : '—'}
                        </td>
                        <td className={cn('px-5 py-3 text-right font-semibold tabular-nums', d.total >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {d.n > 0 ? formatCurrency(d.total) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-700 px-1">
                Days with fewer than 5 trades may not reflect a reliable pattern yet.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Emotion × Grade Matrix ────────────────────────────────────────────── */}
      {tab === 'emotiongrade' && (() => {
        const { matrix, MOODS, GRADES, byGrade, byMood, untagged } = emotionGradeData
        const tagged = trades.length - untagged

        const cellAvg = (cell: { n: number; pnl: number }) =>
          cell.n > 0 ? cell.pnl / cell.n : null

        const cellColor = (avg: number | null, n: number) => {
          if (avg === null || n === 0) return 'text-gray-700'
          if (n < 3) return 'text-gray-500'
          return avg >= 0 ? 'text-emerald-400' : 'text-red-400'
        }
        const cellBg = (avg: number | null, n: number) => {
          if (avg === null || n < 3) return ''
          return avg >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
        }

        const MOOD_SHORT: Record<string, string> = {
          calm: 'Calm', confident: 'Confident', anxious: 'Anxious',
          FOMO: 'FOMO', revenge: 'Revenge', hesitant: 'Hesitant',
          bored: 'Bored', overconfident: 'Overconf.',
        }

        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-semibold text-white">Emotion × Grade Matrix</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                Does calm + A-grade actually make money? Each cell shows avg net P&amp;L for that mood/grade combination.
                Dimmed = fewer than 3 trades (not enough signal).
              </p>
            </div>

            {tagged === 0 ? (
              <EmptyState message="No trades with both mood and grade set — annotate trades to populate this matrix" />
            ) : (
              <>
                {/* Data coverage note */}
                {untagged > 0 && (
                  <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-800/40 border border-gray-700/40 rounded-lg px-4 py-2.5">
                    <span>{tagged} of {trades.length} trades have both mood + grade set.</span>
                    <span className="text-gray-700">{untagged} fully untagged trades are excluded from this view.</span>
                  </div>
                )}

                {/* Grade summary row */}
                <div className="grid grid-cols-3 gap-4">
                  {GRADES.map(g => {
                    const c = byGrade[g]
                    const avg = cellAvg(c)
                    return (
                      <div key={g} className={cn('rounded-xl border p-4', avg !== null && c.n >= 3 ? (avg >= 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5') : 'border-gray-700/50 bg-gray-800/50')}>
                        <p className="text-xs text-gray-400 font-medium">Grade {g} — all moods</p>
                        <p className={cn('text-2xl font-bold mt-1', avg !== null && c.n >= 3 ? (avg >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-500')}>
                          {avg !== null && c.n > 0 ? formatCurrency(avg) : '—'}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">{c.n} trades · {c.n > 0 ? ((c.wins / c.n) * 100).toFixed(0) : '—'}% win rate</p>
                      </div>
                    )
                  })}
                </div>

                {/* Full matrix */}
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-700/50">
                        <th className="text-left px-4 py-3 text-gray-400 font-semibold w-12">Grade</th>
                        {MOODS.map(m => (
                          <th key={m} className="px-2 py-3 text-center text-gray-400 font-semibold whitespace-nowrap">
                            {MOOD_SHORT[m] ?? m}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {GRADES.map(grade => (
                        <tr key={grade} className="border-b border-gray-700/20">
                          <td className="px-4 py-3 font-bold text-gray-200 text-sm">{grade}</td>
                          {MOODS.map(mood => {
                            const cell = matrix[grade][mood]
                            const avg = cellAvg(cell)
                            return (
                              <td key={mood} className="px-2 py-2 text-center">
                                {cell.n === 0 ? (
                                  <span className="text-gray-800">—</span>
                                ) : (
                                  <div className={cn('rounded px-1.5 py-1 inline-block min-w-[58px]', cellBg(avg, cell.n))}>
                                    <div className={cn('font-bold tabular-nums', cellColor(avg, cell.n))}>
                                      {avg !== null ? formatCurrency(avg) : '—'}
                                    </div>
                                    <div className="text-gray-600 text-[10px]">n={cell.n}</div>
                                  </div>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {/* Mood totals row */}
                      <tr className="border-t border-gray-700/50 bg-gray-900/30">
                        <td className="px-4 py-3 text-xs text-gray-500 font-semibold">All</td>
                        {MOODS.map(mood => {
                          const cell = byMood[mood]
                          const avg = cellAvg(cell)
                          return (
                            <td key={mood} className="px-2 py-2 text-center">
                              {cell.n === 0 ? (
                                <span className="text-gray-800">—</span>
                              ) : (
                                <div className={cn('rounded px-1.5 py-1 inline-block min-w-[58px]', cellBg(avg, cell.n))}>
                                  <div className={cn('font-bold tabular-nums', cellColor(avg, cell.n))}>
                                    {avg !== null ? formatCurrency(avg) : '—'}
                                  </div>
                                  <div className="text-gray-600 text-[10px]">n={cell.n}</div>
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-5 text-[11px] text-gray-500 px-1 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/30 flex-shrink-0" />
                    <span>Positive avg P&L</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-red-500/10 border border-red-500/20 flex-shrink-0" />
                    <span>Negative avg P&L</span>
                  </div>
                  <span className="text-gray-700">n&lt;3 = dimmed — don&apos;t conclude</span>
                  <span className="ml-auto text-gray-700">Avg P&L is net (after commissions)</span>
                </div>
              </>
            )}
          </div>
        )
      })()}
    </div>
  )
}
