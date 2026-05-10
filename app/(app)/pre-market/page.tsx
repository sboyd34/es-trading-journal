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
} from 'lucide-react'

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

  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')

  const supabase = createClient()

  const loadSessions = useCallback(async () => {
    setLoadingSession(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: sessions } = await supabase
      .from('daily_sessions')
      .select('*')
      .eq('user_id', user.id)
      .in('date', [today, yesterday])

    if (sessions) {
      const todaySession = sessions.find((s: DailySession) => s.date === today)
      const yesterdaySession = sessions.find((s: DailySession) => s.date === yesterday)
      setTodayBrief(todaySession?.pre_market_brief || null)
      setYesterdayBrief(yesterdaySession?.pre_market_brief || null)
    }
    setLoadingSession(false)
  }, [supabase, today, yesterday])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

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
        body: JSON.stringify({ context }),
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
            <span className="text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2 py-1 rounded-full">
              Ready to trade
            </span>
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
