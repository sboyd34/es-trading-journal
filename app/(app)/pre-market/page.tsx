'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DailySession, PreMarketBrief } from '@/types'
import { format, subDays, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import {
  TrendingUp,
  MapPin,
  Calendar,
  Target,
  GitBranch,
  AlertTriangle,
  Shield,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  Newspaper,
  ExternalLink,
} from 'lucide-react'
import MarketStateCard from '@/components/market/MarketStateCard'

interface PreMarketNewsArticle {
  id: string
  title: string
  source: string
  publishedAt: string
  url: string
  impact: 'HIGH' | 'MED' | 'STD'
}

const IMPACT_BADGE: Record<PreMarketNewsArticle['impact'], string> = {
  HIGH: 'bg-red-500/20 text-red-400 border border-red-500/40',
  MED: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',
  STD: 'bg-gray-500/20 text-gray-500 border border-gray-600/40',
}

function formatRelative(publishedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(publishedAt).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return `${h}h ago`
}

interface BriefSection {
  key: keyof PreMarketBrief
  label: string
  icon: React.ReactNode
  color: string
}

const SECTIONS: BriefSection[] = [
  { key: 'market_condition', label: 'Market Condition', icon: <TrendingUp className="h-4 w-4" />, color: 'text-blue-400' },
  { key: 'location', label: 'Price Location', icon: <MapPin className="h-4 w-4" />, color: 'text-purple-400' },
  { key: 'day_type_expectation', label: 'Day Type Expectation', icon: <Calendar className="h-4 w-4" />, color: 'text-yellow-400' },
  { key: 'key_levels', label: 'Key Levels', icon: <Target className="h-4 w-4" />, color: 'text-orange-400' },
  { key: 'if_then_plan', label: 'If/Then Plan', icon: <GitBranch className="h-4 w-4" />, color: 'text-emerald-400' },
  { key: 'what_not_to_do', label: 'What NOT To Do', icon: <AlertTriangle className="h-4 w-4" />, color: 'text-red-400' },
  { key: 'risk_level', label: 'Risk Level', icon: <Shield className="h-4 w-4" />, color: 'text-cyan-400' },
]

function BriefCard({ section, value }: { section: BriefSection; value: string }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className={cn('flex items-center gap-2 mb-2', section.color)}>
        {section.icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{section.label}</span>
      </div>
      <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{value}</p>
    </div>
  )
}

export default function PreMarketPage() {
  const [context, setContext] = useState('')
  const [generating, setGenerating] = useState(false)
  const [todayBrief, setTodayBrief] = useState<PreMarketBrief | null>(null)
  const [yesterdayBrief, setYesterdayBrief] = useState<PreMarketBrief | null>(null)
  const [yesterdayExpanded, setYesterdayExpanded] = useState(false)
  const [loadingSession, setLoadingSession] = useState(true)
  const [preMarketNews, setPreMarketNews] = useState<PreMarketNewsArticle[]>([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [autoImported, setAutoImported] = useState(false)

  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

  const supabase = createClient()

  const loadSessions = useCallback(async () => {
    setLoadingSession(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: sessions }, { data: briefs }] = await Promise.all([
      supabase
        .from('daily_sessions')
        .select('*')
        .eq('user_id', user.id)
        .in('date', [today, yesterday]),
      supabase
        .from('daily_briefs')
        .select('brief_text, plan_json, date')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle(),
    ])

    if (sessions) {
      const todaySession = sessions.find((s: DailySession) => s.date === today)
      const yesterdaySession = sessions.find((s: DailySession) => s.date === yesterday)
      setTodayBrief(todaySession?.pre_market_brief || null)
      setYesterdayBrief(yesterdaySession?.pre_market_brief || null)
    }

    if (briefs) {
      setAutoImported(true)
      // Pre-populate the textarea with the raw brief text if user hasn't typed yet
      setContext((prev) => prev || briefs.brief_text)
      // If plan_json exists and no session plan was loaded yet, use it directly
      if (briefs.plan_json) {
        setTodayBrief((prev) => prev ?? briefs.plan_json)
      }
    }

    setLoadingSession(false)
  }, [supabase, today, yesterday])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    async function loadNews() {
      try {
        const res = await fetch('/api/news?limit=3&hours=12')
        const data = await res.json()
        setPreMarketNews(data.articles || [])
      } catch {
        // best-effort
      } finally {
        setNewsLoading(false)
      }
    }
    loadNews()
  }, [])

  async function handleGenerate() {
    if (!context.trim()) {
      toast.error('Please add some market observations first')
      return
    }
    setGenerating(true)
    try {
      const res = await fetch('/api/claude/pre-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, newsHeadlines: preMarketNews }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Generation failed')
      }

      const { brief } = await res.json()
      setTodayBrief(brief)
      toast.success('Pre-market brief generated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate brief')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Pre-Market Brief</h1>
        <p className="text-sm text-gray-400 mt-1">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      {/* Auto-pulled market state (yesterday H/L/C, today's gap, opening range) */}
      <MarketStateCard
        onUseLevels={(text) => {
          setContext((prev) => prev.includes(text) ? prev : (prev.trim() ? `${text}\n\n${prev}` : text))
          toast.success('Reference levels added to your brief')
        }}
      />

      {/* Pre-market news panel */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700/40">
          <Newspaper className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-200">Recent Headlines</span>
          <span className="text-xs text-gray-500 ml-1">(last 12 hours)</span>
        </div>
        {newsLoading ? (
          <div className="px-4 py-5 text-xs text-gray-500 text-center">Loading headlines...</div>
        ) : preMarketNews.length === 0 ? (
          <div className="px-4 py-5 text-xs text-gray-500 text-center">No recent headlines available</div>
        ) : (
          <div className="divide-y divide-gray-700/30">
            {preMarketNews.map((article) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 px-4 py-3 hover:bg-gray-700/20 transition group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200 leading-snug line-clamp-2 group-hover:text-white transition">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500">{article.source}</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-xs text-gray-500">{formatRelative(article.publishedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 pt-0.5">
                  <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide', IMPACT_BADGE[article.impact])}>
                    {article.impact}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-gray-600 group-hover:text-gray-400 transition" />
                </div>
              </a>
            ))}
          </div>
        )}
        {preMarketNews.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-700/40 text-xs text-gray-600">
            These headlines will be included in your AI brief automatically.
          </div>
        )}
      </div>

      {/* Input section */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <label className="block text-sm font-semibold text-gray-200 mb-3">
          Your Market Observations
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={6}
          placeholder={`Paste your pre-market notes here. Include:
• Overnight price action (gap up/down, range)
• Key levels you're watching
• Economic news or Fed events
• Sector strength/weakness
• VIX, futures, etc.
• Your gut feeling about today`}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="flex justify-end mt-3">
          <button
            onClick={handleGenerate}
            disabled={generating || !context.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : todayBrief ? (
              <>
                <RefreshCw className="h-4 w-4" />
                Regenerate Brief
              </>
            ) : (
              'Generate Brief'
            )}
          </button>
        </div>
      </div>

      {/* Today's brief */}
      {loadingSession ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : todayBrief ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Today&apos;s Brief</h2>
            <div className="flex items-center gap-2">
              {autoImported && (
                <span className="text-xs text-blue-400 bg-blue-400/10 border border-blue-400/20 px-2 py-1 rounded-full">
                  Auto-imported ✓
                </span>
              )}
              <span className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2 py-1 rounded-full">
                Ready to trade
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {SECTIONS.map((section) => (
              <BriefCard
                key={section.key}
                section={section}
                value={todayBrief[section.key] || 'Not specified'}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-10 bg-gray-800/30 border border-gray-700/50 rounded-xl">
          <p className="text-gray-400 font-medium">No brief generated yet</p>
          <p className="text-gray-600 text-sm mt-1">Add your market observations above and click Generate Brief</p>
        </div>
      )}

      {/* Yesterday's brief (collapsible) */}
      {yesterdayBrief && (
        <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl overflow-hidden">
          <button
            onClick={() => setYesterdayExpanded(!yesterdayExpanded)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-800/50 transition"
          >
            <span className="text-sm font-medium text-gray-400">Yesterday&apos;s Brief — {format(parseISO(yesterday), 'MMMM d')}</span>
            {yesterdayExpanded ? (
              <ChevronUp className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-500" />
            )}
          </button>
          {yesterdayExpanded && (
            <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              {SECTIONS.map((section) => (
                <div key={section.key} className="bg-gray-900/50 border border-gray-800 rounded-lg p-3 opacity-70">
                  <div className={cn('flex items-center gap-2 mb-1.5 text-xs font-medium', section.color)}>
                    {section.icon}
                    {section.label}
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{yesterdayBrief[section.key] || '—'}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
