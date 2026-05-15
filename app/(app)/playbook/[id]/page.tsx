'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Trade, PlaybookSetup } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, cn, getGradeColor, getMoodEmoji } from '@/lib/utils'
import EquityCurve from '@/components/dashboard/EquityCurve'
import { classifyWindow, ctTimeLabel } from '@/lib/trade-flags'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  Pencil,
  Save,
  X,
  Trophy,
  AlertTriangle,
  Clock,
  CalendarDays,
  Compass,
  Smile,
  Award,
  Target as TargetIcon,
} from 'lucide-react'

const WINDOW_LABELS: Record<string, string> = {
  primary: '08:45–09:30 ORB',
  continuation: '09:30–10:30 Continuation',
  late: '10:30–11:00 A+ Only',
  secondary: '12:30–14:00 Secondary',
  building: '08:30–08:45 Building (banned)',
  dead_zone: '11:00–12:30 Dead Zone (banned)',
  closed: 'After 14:00 (closed)',
  unknown: 'Unknown',
}

const WINDOW_ORDER: string[] = [
  'primary',
  'continuation',
  'late',
  'secondary',
  'building',
  'dead_zone',
  'closed',
  'unknown',
]

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

function ctMins(entryTime: string): number | null {
  try {
    const s = new Date(entryTime).toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
    const [h, m] = s.split(':').map(Number)
    return h * 60 + m
  } catch {
    return null
  }
}

function ctWeekday(date: string): string {
  // Parse YYYY-MM-DD as local date (avoids UTC shift)
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]
}

interface BucketStats {
  key: string
  label: string
  trades: number
  winRate: number
  totalPnL: number
  avgPnL: number
  expectancy: number
}

function bucketize(trades: Trade[], keyFn: (t: Trade) => string | null, labelMap?: Record<string, string>): BucketStats[] {
  const groups: Record<string, Trade[]> = {}
  for (const t of trades) {
    const k = keyFn(t)
    if (k === null) continue
    groups[k] = groups[k] || []
    groups[k].push(t)
  }
  return Object.entries(groups).map(([k, ts]) => {
    const winners = ts.filter((t) => t.net_pnl > 0)
    const losers = ts.filter((t) => t.net_pnl <= 0)
    const totalPnL = ts.reduce((s, t) => s + t.net_pnl, 0)
    const winRate = (winners.length / ts.length) * 100
    const avgWin = winners.length ? winners.reduce((s, t) => s + t.net_pnl, 0) / winners.length : 0
    const avgLoss = losers.length ? Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0) / losers.length) : 0
    const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss
    return {
      key: k,
      label: labelMap?.[k] || k,
      trades: ts.length,
      winRate,
      totalPnL,
      avgPnL: totalPnL / ts.length,
      expectancy,
    }
  })
}

export default function PlaybookSetupDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [setup, setSetup] = useState<PlaybookSetup | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Edit form state
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState('')
  const [entryCriteria, setEntryCriteria] = useState('')
  const [exitCriteria, setExitCriteria] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const [{ data: setupData, error: setupErr }, { data: tradeData }] = await Promise.all([
      supabase.from('playbook_setups').select('*').eq('id', params.id).eq('user_id', user.id).single(),
      supabase.from('trades').select('*').eq('user_id', user.id),
    ])

    if (setupErr || !setupData) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const s = setupData as PlaybookSetup
    setSetup(s)
    setDescription(s.description || '')
    setEntryCriteria(s.entry_criteria || '')
    setExitCriteria(s.exit_criteria || '')
    setTags((s.tags || []).join(', '))
    setTrades(((tradeData as Trade[]) || []).filter((t) => t.setup_tag === s.name))
    setLoading(false)
  }, [supabase, params.id])

  useEffect(() => {
    loadData()
  }, [loadData])

  const stats = useMemo(() => {
    if (!trades.length) return null
    const winners = trades.filter((t) => t.net_pnl > 0)
    const losers = trades.filter((t) => t.net_pnl <= 0)
    const totalPnL = trades.reduce((s, t) => s + t.net_pnl, 0)
    const grossWins = winners.reduce((s, t) => s + t.net_pnl, 0)
    const grossLosses = Math.abs(losers.reduce((s, t) => s + t.net_pnl, 0))
    const avgWin = winners.length ? grossWins / winners.length : 0
    const avgLoss = losers.length ? grossLosses / losers.length : 0
    const winRate = (winners.length / trades.length) * 100
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0
    const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss

    // R-multiple: average ratio of net_pnl to initial risk per trade. Risk = |entry - stop| * qty * 50.
    const rMultiples = trades
      .map((t) => {
        if (!t.stop_loss) return null
        const riskPerContract = Math.abs(t.entry_price - t.stop_loss) * 50
        const totalRisk = riskPerContract * t.quantity
        if (totalRisk <= 0) return null
        return t.net_pnl / totalRisk
      })
      .filter((x): x is number => x !== null)
    const avgR = rMultiples.length ? rMultiples.reduce((s, x) => s + x, 0) / rMultiples.length : null

    // MFE / MAE summary
    const winnersMAE = winners.filter((t) => t.mae !== null).map((t) => Math.abs(t.mae as number))
    const losersMFE = losers.filter((t) => t.mfe !== null).map((t) => Math.abs(t.mfe as number))
    const winnersMFE = winners.filter((t) => t.mfe !== null).map((t) => Math.abs(t.mfe as number))

    const avgWinnerMAE = winnersMAE.length ? winnersMAE.reduce((s, x) => s + x, 0) / winnersMAE.length : null
    const avgLoserMFE = losersMFE.length ? losersMFE.reduce((s, x) => s + x, 0) / losersMFE.length : null
    const avgWinnerMFE = winnersMFE.length ? winnersMFE.reduce((s, x) => s + x, 0) / winnersMFE.length : null

    // Target tightness — for winners, how close did MFE get to the target?
    const winnersWithTarget = winners.filter((t) => t.mfe !== null && t.target !== null)
    const captureRates = winnersWithTarget.map((t) => {
      const reachable = Math.abs((t.target as number) - t.entry_price)
      const captured = Math.abs(t.mfe as number)
      return reachable > 0 ? Math.min(captured / reachable, 1.0) : null
    }).filter((x): x is number => x !== null)
    const avgCapture = captureRates.length ? (captureRates.reduce((s, x) => s + x, 0) / captureRates.length) * 100 : null

    return {
      trades: trades.length,
      winners: winners.length,
      losers: losers.length,
      totalPnL,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      avgR,
      avgWinnerMAE,
      avgLoserMFE,
      avgWinnerMFE,
      avgCapture,
    }
  }, [trades])

  const byWindow = useMemo<BucketStats[]>(() => {
    return bucketize(trades, (t) => {
      const m = ctMins(t.entry_time)
      if (m === null) return null
      return classifyWindow(m)
    }, WINDOW_LABELS).sort((a, b) => WINDOW_ORDER.indexOf(a.key) - WINDOW_ORDER.indexOf(b.key))
  }, [trades])

  const byDay = useMemo<BucketStats[]>(() => {
    return bucketize(trades, (t) => ctWeekday(t.date)).sort((a, b) => DAYS.indexOf(a.key) - DAYS.indexOf(b.key))
  }, [trades])

  const byBias = useMemo<BucketStats[]>(() => {
    return bucketize(trades, (t) => t.trade_bias || null)
  }, [trades])

  const byMood = useMemo<BucketStats[]>(() => {
    return bucketize(trades, (t) => t.mood || null)
  }, [trades])

  const byGrade = useMemo<BucketStats[]>(() => {
    return bucketize(trades, (t) => t.grade || null).sort((a, b) => a.key.localeCompare(b.key))
  }, [trades])

  const bestWorst = useMemo(() => {
    const sorted = [...trades].sort((a, b) => b.net_pnl - a.net_pnl)
    return {
      best: sorted.slice(0, 5),
      worst: sorted.slice(-5).reverse(),
    }
  }, [trades])

  const recentTrades = useMemo(() => {
    return [...trades].sort((a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime())
  }, [trades])

  async function handleSave() {
    if (!setup) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('playbook_setups')
        .update({
          description: description.trim(),
          entry_criteria: entryCriteria.trim(),
          exit_criteria: exitCriteria.trim(),
          tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        })
        .eq('id', setup.id)

      if (error) throw error
      setSetup({
        ...setup,
        description: description.trim(),
        entry_criteria: entryCriteria.trim(),
        exit_criteria: exitCriteria.trim(),
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      })
      setEditing(false)
      toast.success('Setup updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    if (!setup) return
    setDescription(setup.description || '')
    setEntryCriteria(setup.entry_criteria || '')
    setExitCriteria(setup.exit_criteria || '')
    setTags((setup.tags || []).join(', '))
    setEditing(false)
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading setup analysis...</div>
  }

  if (notFound || !setup) {
    return (
      <div className="space-y-6">
        <Link href="/playbook" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to Playbook
        </Link>
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-12 text-center">
          <p className="text-gray-400">Setup not found</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <Link href="/playbook" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-3">
          <ArrowLeft className="h-4 w-4" /> Back to Playbook
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">{setup.name}</h1>
            <p className="text-sm text-gray-400 mt-1">
              {trades.length} trade{trades.length !== 1 ? 's' : ''} logged with this setup
            </p>
            {setup.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {setup.tags.map((tag) => (
                  <span key={tag} className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          {stats && (
            <div className={cn('text-right')}>
              <p className="text-xs text-gray-500">Total P&L</p>
              <p className={cn('text-3xl font-bold', stats.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {formatCurrency(stats.totalPnL)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Empty state if no trades */}
      {!stats && (
        <div className="bg-gray-800/30 border border-gray-700/50 border-dashed rounded-xl p-12 text-center">
          <TargetIcon className="h-10 w-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 font-medium">No trades tagged with &quot;{setup.name}&quot; yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Tag trades with this setup name in the journal to see analytics here.
          </p>
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatTile label="Trades" value={String(stats.trades)} />
          <StatTile
            label="Win Rate"
            value={`${stats.winRate.toFixed(1)}%`}
            tone={stats.winRate >= 50 ? 'pos' : 'warn'}
          />
          <StatTile
            label="Avg Win"
            value={formatCurrency(stats.avgWin)}
            tone="pos"
          />
          <StatTile
            label="Avg Loss"
            value={formatCurrency(-stats.avgLoss)}
            tone="neg"
          />
          <StatTile
            label="Profit Factor"
            value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
            tone={stats.profitFactor >= 1.5 ? 'pos' : stats.profitFactor >= 1 ? 'warn' : 'neg'}
          />
          <StatTile
            label="Expectancy"
            value={formatCurrency(stats.expectancy)}
            tone={stats.expectancy >= 0 ? 'pos' : 'neg'}
          />
          <StatTile
            label="Avg R"
            value={stats.avgR !== null ? `${stats.avgR >= 0 ? '+' : ''}${stats.avgR.toFixed(2)}R` : '—'}
            tone={stats.avgR !== null ? (stats.avgR >= 0 ? 'pos' : 'neg') : 'neutral'}
          />
          <StatTile
            label="Target Capture"
            value={stats.avgCapture !== null ? `${stats.avgCapture.toFixed(0)}%` : '—'}
            tone={stats.avgCapture !== null ? (stats.avgCapture >= 70 ? 'pos' : 'warn') : 'neutral'}
          />
        </div>
      )}

      {/* Equity curve */}
      {stats && (
        <EquityCurve trades={trades} />
      )}

      {/* Performance breakdowns */}
      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <BreakdownCard
            title="By Time Window (CT)"
            icon={<Clock className="h-4 w-4" />}
            buckets={byWindow}
            highlightApproved={['primary', 'continuation', 'late', 'secondary']}
          />
          <BreakdownCard
            title="By Day of Week"
            icon={<CalendarDays className="h-4 w-4" />}
            buckets={byDay}
          />
          <BreakdownCard
            title="By 1H Bias"
            icon={<Compass className="h-4 w-4" />}
            buckets={byBias}
          />
          <BreakdownCard
            title="By Mood"
            icon={<Smile className="h-4 w-4" />}
            buckets={byMood}
            decorateLabel={(k) => `${getMoodEmoji(k)} ${k}`}
          />
          <BreakdownCard
            title="By Grade"
            icon={<Award className="h-4 w-4" />}
            buckets={byGrade}
          />
          <LifetimeCard stats={stats} />
        </div>
      )}

      {/* Best / Worst trades */}
      {stats && (bestWorst.best.length > 0 || bestWorst.worst.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TopTradesCard
            title="Best Trades"
            trades={bestWorst.best}
            icon={<Trophy className="h-4 w-4 text-emerald-400" />}
            tone="pos"
          />
          <TopTradesCard
            title="Worst Trades"
            trades={bestWorst.worst}
            icon={<AlertTriangle className="h-4 w-4 text-red-400" />}
            tone="neg"
          />
        </div>
      )}

      {/* Setup criteria (editable) */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-200">Playbook Criteria</h2>
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={cancelEdit}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-2.5 py-1 rounded transition"
              >
                <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <CriteriaBlock
            label="Description"
            value={description}
            onChange={setDescription}
            editing={editing}
            displayValue={setup.description}
            placeholder="Brief overview of this setup..."
            rows={2}
            color="gray"
          />
          <CriteriaBlock
            label="Entry Criteria"
            value={entryCriteria}
            onChange={setEntryCriteria}
            editing={editing}
            displayValue={setup.entry_criteria}
            placeholder="What conditions must be met to enter this trade?"
            rows={5}
            color="emerald"
          />
          <CriteriaBlock
            label="Exit Criteria"
            value={exitCriteria}
            onChange={setExitCriteria}
            editing={editing}
            displayValue={setup.exit_criteria}
            placeholder="When do you exit?"
            rows={4}
            color="red"
          />
          {editing && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Tags (comma separated)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="momentum, breakout, ..."
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Full trade table */}
      {recentTrades.length > 0 && (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700/50">
            <h2 className="text-sm font-semibold text-gray-200">All Trades ({recentTrades.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Date</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Time (CT)</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Dir</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Entry</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Exit</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">P&L</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500">Grade</th>
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500">Mood</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer"
                    onClick={() => router.push(`/journal?trade=${trade.id}`)}
                  >
                    <td className="px-4 py-2.5 text-gray-300 text-xs">{format(parseISO(trade.date), 'MM/dd/yy')}</td>
                    <td className="px-4 py-2.5 text-gray-300 text-xs font-mono">{ctTimeLabel(trade.entry_time) ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('text-xs font-semibold', trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400')}>
                        {trade.direction === 'long' ? 'L' : 'S'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-300 font-mono text-xs">{trade.entry_price.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-300 font-mono text-xs">{trade.exit_price.toFixed(2)}</td>
                    <td className={cn('px-4 py-2.5 text-right font-semibold text-xs', trade.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {formatCurrency(trade.net_pnl)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {trade.grade ? (
                        <span className={cn('inline-block text-xs font-semibold px-1.5 py-0.5 rounded', getGradeColor(trade.grade))}>
                          {trade.grade}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs">{getMoodEmoji(trade.mood)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'pos' | 'neg' | 'warn' | 'neutral' }) {
  const toneClass =
    tone === 'pos' ? 'text-emerald-400' :
    tone === 'neg' ? 'text-red-400' :
    tone === 'warn' ? 'text-yellow-400' :
    'text-white'
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={cn('text-lg font-semibold mt-0.5', toneClass)}>{value}</p>
    </div>
  )
}

interface BreakdownCardProps {
  title: string
  icon?: React.ReactNode
  buckets: BucketStats[]
  highlightApproved?: string[]
  decorateLabel?: (key: string) => string
}

function BreakdownCard({ title, icon, buckets, highlightApproved, decorateLabel }: BreakdownCardProps) {
  if (buckets.length === 0) return null
  const maxAbs = Math.max(...buckets.map((b) => Math.abs(b.totalPnL)), 1)
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      </div>
      <div className="space-y-2">
        {buckets.map((b) => {
          const isApproved = highlightApproved ? highlightApproved.includes(b.key) : true
          const widthPct = Math.min((Math.abs(b.totalPnL) / maxAbs) * 100, 100)
          return (
            <div key={b.key} className="text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className={cn('font-medium', isApproved ? 'text-gray-200' : 'text-amber-400/80')}>
                  {decorateLabel ? decorateLabel(b.key) : b.label}
                  {!isApproved && <span className="ml-1 text-[10px]">⚠</span>}
                </span>
                <span className="text-gray-500">
                  {b.trades} · {b.winRate.toFixed(0)}% wins
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-900/50 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', b.totalPnL >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60')}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className={cn('font-mono text-[11px] w-20 text-right', b.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {formatCurrency(b.totalPnL)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface LifetimeStats {
  avgWinnerMAE: number | null
  avgLoserMFE: number | null
  avgWinnerMFE: number | null
  avgCapture: number | null
}

function LifetimeCard({ stats }: { stats: LifetimeStats }) {
  const hasAny =
    stats.avgWinnerMAE !== null || stats.avgLoserMFE !== null || stats.avgWinnerMFE !== null || stats.avgCapture !== null
  if (!hasAny) return null
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TargetIcon className="h-4 w-4" />
        <h3 className="text-sm font-semibold text-gray-200">Trade Lifetime (MFE / MAE)</h3>
      </div>
      <div className="space-y-2.5 text-xs">
        <Row label="Avg MAE on winners" value={stats.avgWinnerMAE !== null ? `${stats.avgWinnerMAE.toFixed(2)} pts` : '—'} hint="How much heat winners took (lower = cleaner entries)" />
        <Row label="Avg MFE on winners" value={stats.avgWinnerMFE !== null ? `${stats.avgWinnerMFE.toFixed(2)} pts` : '—'} hint="Max favorable excursion on winning trades" />
        <Row label="Avg MFE on losers" value={stats.avgLoserMFE !== null ? `${stats.avgLoserMFE.toFixed(2)} pts` : '—'} hint="Profit you left on the table on losing trades" />
        <Row label="Target capture rate" value={stats.avgCapture !== null ? `${stats.avgCapture.toFixed(0)}%` : '—'} hint="% of target distance captured by winners" tone={stats.avgCapture !== null && stats.avgCapture >= 70 ? 'pos' : 'neutral'} />
      </div>
    </div>
  )
}

function Row({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint?: string; tone?: 'pos' | 'neg' | 'neutral' }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-gray-400">{label}</span>
        <span className={cn(
          'font-mono font-semibold',
          tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-white'
        )}>
          {value}
        </span>
      </div>
      {hint && <p className="text-[10px] text-gray-600 mt-0.5">{hint}</p>}
    </div>
  )
}

function TopTradesCard({ title, trades, icon, tone }: { title: string; trades: Trade[]; icon: React.ReactNode; tone: 'pos' | 'neg' }) {
  if (trades.length === 0) return null
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      </div>
      <div className="space-y-1.5">
        {trades.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-700/30 last:border-0">
            <div className="flex items-center gap-2">
              <span className="text-gray-400">{format(parseISO(t.date), 'MM/dd')}</span>
              <span className={cn('font-semibold', t.direction === 'long' ? 'text-emerald-400' : 'text-red-400')}>
                {t.direction === 'long' ? 'L' : 'S'}
              </span>
              <span className="text-gray-300 font-mono">{t.entry_price.toFixed(2)} → {t.exit_price.toFixed(2)}</span>
              {t.grade && (
                <span className={cn('text-[10px] font-semibold px-1 rounded', getGradeColor(t.grade))}>
                  {t.grade}
                </span>
              )}
            </div>
            <span className={cn('font-semibold font-mono', tone === 'pos' ? 'text-emerald-400' : 'text-red-400')}>
              {formatCurrency(t.net_pnl)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CriteriaBlock({
  label,
  value,
  onChange,
  editing,
  displayValue,
  placeholder,
  rows,
  color,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  editing: boolean
  displayValue: string
  placeholder: string
  rows: number
  color: 'emerald' | 'red' | 'gray'
}) {
  const colorClass = color === 'emerald' ? 'text-emerald-400' : color === 'red' ? 'text-red-400' : 'text-gray-400'
  return (
    <div>
      <label className={cn('block text-xs font-medium mb-1.5', colorClass)}>{label}</label>
      {editing ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      ) : (
        <p className="text-sm text-gray-300 whitespace-pre-line">
          {displayValue || <span className="text-gray-600 italic">Not set</span>}
        </p>
      )}
    </div>
  )
}
