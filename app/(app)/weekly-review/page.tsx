'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Trade, WeeklyReview } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  Sparkles,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Lightbulb,
  Target,
  Heart,
  BarChart3,
} from 'lucide-react'

function dateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + n)
  return next
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Returns Monday of the week containing today (local time).
function thisWeekMonday(): string {
  const now = new Date()
  // Convert to UTC date-only first so we never drift across timezone boundaries.
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  const utc = new Date(Date.UTC(y, m, d))
  const day = utc.getUTCDay() // 0 Sun, 1 Mon, ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day // shift to Monday
  return isoDate(addDays(utc, diff))
}

function formatWeekRange(start: string, end: string): string {
  const s = dateOnly(start)
  const e = dateOnly(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const startStr = s.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
  const endStr = e.toLocaleDateString('en-US', { ...opts, year: 'numeric', timeZone: 'UTC' })
  return `${startStr} – ${endStr}`
}

export default function WeeklyReviewPage() {
  const supabase = createClient()
  const [weekStart, setWeekStart] = useState(thisWeekMonday())
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [weekTrades, setWeekTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const weekEnd = useMemo(() => isoDate(addDays(dateOnly(weekStart), 6)), [weekStart])

  const loadWeek = useCallback(async () => {
    setLoading(true)
    setReview(null)
    setWeekTrades([])
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const [{ data: reviewData }, { data: tradeData }] = await Promise.all([
      supabase
        .from('weekly_reviews')
        .select('*')
        .eq('user_id', user.id)
        .eq('week_start_date', weekStart)
        .maybeSingle(),
      supabase
        .from('trades')
        .select('*')
        .eq('user_id', user.id)
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .order('entry_time', { ascending: true }),
    ])

    if (reviewData) setReview(reviewData as WeeklyReview)
    setWeekTrades((tradeData as Trade[]) || [])
    setLoading(false)
  }, [supabase, weekStart, weekEnd])

  useEffect(() => {
    loadWeek()
  }, [loadWeek])

  const weekStats = useMemo(() => {
    if (!weekTrades.length) return null
    const winners = weekTrades.filter((t) => t.net_pnl > 0)
    const totalPnL = weekTrades.reduce((s, t) => s + t.net_pnl, 0)
    const tradingDays = new Set(weekTrades.map((t) => t.date)).size
    return {
      total: weekTrades.length,
      winners: winners.length,
      losers: weekTrades.length - winners.length,
      winRate: (winners.length / weekTrades.length) * 100,
      totalPnL,
      tradingDays,
    }
  }, [weekTrades])

  async function generateReview() {
    if (!weekTrades.length) {
      toast.error('No trades in this week')
      return
    }
    setGenerating(true)
    try {
      const res = await fetch('/api/claude/weekly-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDate: weekStart }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to generate review')
      }
      toast.success('Weekly review generated')
      await loadWeek()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function changeWeek(delta: number) {
    setWeekStart(isoDate(addDays(dateOnly(weekStart), delta * 7)))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CalendarRange className="h-6 w-6 text-purple-400" />
            Weekly Review
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            AI-generated review of your trading week against the system rules.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => changeWeek(-1)}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition"
            title="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="px-4 py-2 bg-gray-800 border border-gray-700/50 rounded-lg">
            <p className="text-sm font-semibold text-white">{formatWeekRange(weekStart, weekEnd)}</p>
            <p className="text-[10px] text-gray-500 text-center">Mon – Sun</p>
          </div>
          <button
            onClick={() => changeWeek(1)}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white transition"
            title="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeekStart(thisWeekMonday())}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition"
          >
            This Week
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <>
          {/* Week stats */}
          {weekStats ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatTile label="Net P&L" value={formatCurrency(weekStats.totalPnL)} tone={weekStats.totalPnL >= 0 ? 'pos' : 'neg'} />
              <StatTile label="Trades" value={String(weekStats.total)} />
              <StatTile label="Win Rate" value={`${weekStats.winRate.toFixed(0)}%`} tone={weekStats.winRate >= 50 ? 'pos' : 'warn'} />
              <StatTile label="W / L" value={`${weekStats.winners} / ${weekStats.losers}`} />
              <StatTile label="Trading Days" value={String(weekStats.tradingDays)} />
            </div>
          ) : (
            <div className="bg-gray-800/30 border border-gray-700/50 border-dashed rounded-xl p-12 text-center">
              <BarChart3 className="h-10 w-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">No trades this week</p>
              <p className="text-gray-600 text-sm mt-1">
                Use the arrows to navigate to a week with trades.
              </p>
            </div>
          )}

          {/* Generate / re-generate */}
          {weekStats && (
            <div className="bg-purple-500/5 border border-purple-500/30 rounded-xl p-4 flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-semibold text-purple-300">
                  {review ? 'Review available' : 'No review yet for this week'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {review
                    ? `Generated ${new Date(review.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
                    : 'Claude will analyze every trade against your rules framework.'}
                </p>
              </div>
              <button
                onClick={generateReview}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
              >
                <Sparkles className={cn('h-4 w-4', generating && 'animate-spin')} />
                {generating ? 'Analyzing...' : review ? 'Re-Generate' : 'Generate Review'}
              </button>
            </div>
          )}

          {/* Review content */}
          {review && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">
                  Week Summary
                </p>
                <p className="text-gray-200 text-sm leading-relaxed">{review.review.summary}</p>
              </div>

              {/* Compliance score */}
              <ComplianceCard compliance={review.review.system_compliance} />

              {/* Setup breakdown */}
              {review.review.setup_breakdown?.length > 0 && (
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-blue-400" />
                    Setup Breakdown
                  </h2>
                  <div className="space-y-3">
                    {review.review.setup_breakdown.map((s, i) => (
                      <div key={i} className="bg-gray-900/40 border border-gray-700/40 rounded-lg p-3">
                        <div className="flex items-center justify-between flex-wrap gap-2 mb-1.5">
                          <span className="text-sm font-semibold text-white">{s.setup}</span>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-gray-400">{s.trades} trade{s.trades !== 1 ? 's' : ''}</span>
                            <span className={cn('font-semibold', s.win_rate >= 50 ? 'text-emerald-400' : 'text-yellow-400')}>
                              {s.win_rate.toFixed(0)}% wins
                            </span>
                            <span className={cn('font-semibold font-mono', s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {formatCurrency(s.pnl)}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 leading-relaxed">{s.key_insight}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Emotional trends */}
              {review.review.emotional_trends && (
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                  <h2 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
                    <Heart className="h-4 w-4 text-pink-400" />
                    Emotional Trends
                  </h2>
                  <p className="text-sm text-gray-300 leading-relaxed">{review.review.emotional_trends}</p>
                </div>
              )}

              {/* Lessons + focus */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-blue-500/5 border border-blue-500/30 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                    <Lightbulb className="h-4 w-4" />
                    Top Lessons
                  </h3>
                  <ul className="space-y-2">
                    {review.review.top_lessons.map((l, i) => (
                      <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                        <span className="text-blue-400 mt-0.5">•</span>
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-amber-400 mb-3 flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Next Week Focus
                  </h3>
                  <ul className="space-y-2">
                    {review.review.next_week_focus.map((f, i) => (
                      <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                        <span className="text-amber-400 mt-0.5">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </>
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

function ComplianceCard({ compliance }: { compliance: { score: number; wins: string[]; violations: string[] } }) {
  const score = Math.max(0, Math.min(100, Math.round(compliance.score)))
  const scoreColor = score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400'
  const barColor = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          System Compliance
        </h2>
        <span className={cn('text-2xl font-bold', scoreColor)}>{score}<span className="text-sm text-gray-500">/100</span></span>
      </div>
      <div className="h-2 bg-gray-900/60 rounded-full overflow-hidden mb-4">
        <div className={cn('h-full transition-all', barColor)} style={{ width: `${score}%` }} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Rules Followed</p>
          {compliance.wins.length > 0 ? (
            <ul className="space-y-1.5">
              {compliance.wins.map((w, i) => (
                <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span>
                  {w}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-600 italic">No rule wins flagged this week</p>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Rule Violations
          </p>
          {compliance.violations.length > 0 ? (
            <ul className="space-y-1.5">
              {compliance.violations.map((v, i) => (
                <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">✗</span>
                  {v}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-600 italic">No violations flagged</p>
          )}
        </div>
      </div>
    </div>
  )
}
