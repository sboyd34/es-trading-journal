'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Newspaper, ExternalLink, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NewsArticle {
  id: string
  title: string
  source: string
  publishedAt: string
  url: string
  impact: 'HIGH' | 'MED' | 'STD'
  tickers: string[]
}

// Secondary window scan: 12:00–14:30 CT
const SECONDARY_SCAN_START = 12 * 60
const SECONDARY_SCAN_END = 14 * 60 + 30

// Keywords that trigger secondary-window macro gate
const MACRO_GATE_KEYWORDS = [
  'fed', 'powell', 'fomc', 'cpi', 'nfp', 'ppi',
  'jobs', 'inflation', 'treasury', 'auction',
]

function getCTMinutes(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}

function isNewsMarketHours(): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const day = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const isWeekday = !['Sat', 'Sun'].includes(day)
  const ctMin = h * 60 + m
  return isWeekday && ctMin >= 8 * 60 && ctMin < 16 * 60 + 30
}

function isMacroKeyword(title: string): boolean {
  const lower = title.toLowerCase()
  return MACRO_GATE_KEYWORDS.some((k) => lower.includes(k))
}

function formatRelative(publishedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(publishedAt).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const IMPACT_BADGE: Record<NewsArticle['impact'], string> = {
  HIGH: 'bg-red-500/20 text-red-400 border border-red-500/40',
  MED: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',
  STD: 'bg-gray-500/20 text-gray-500 border border-gray-600/40',
}

interface Props {
  onMacroEvent?: (detected: boolean) => void
}

export default function MarketNewsFeed({ onMacroEvent }: Props) {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLive, setIsLive] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [macroWarning, setMacroWarning] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastFetchRef = useRef<number>(0)
  const macroRef = useRef(false)

  // Collapse by default on mobile
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setCollapsed(window.innerWidth < 768)
    }
  }, [])

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news?limit=5&hours=24')
      if (!res.ok) throw new Error('fetch failed')
      const data = await res.json()
      if (data.error && !data.articles?.length) {
        setError('News temporarily unavailable')
        return
      }
      const fetched: NewsArticle[] = data.articles || []
      setArticles(fetched)
      setLastUpdated(new Date())
      setError(null)
      lastFetchRef.current = Date.now()

      // Secondary window macro detection
      const ctMin = getCTMinutes()
      if (ctMin >= SECONDARY_SCAN_START && ctMin <= SECONDARY_SCAN_END) {
        const detected = fetched.some((a) => a.impact === 'HIGH' && isMacroKeyword(a.title))
        setMacroWarning(detected)
        if (detected !== macroRef.current) {
          macroRef.current = detected
          onMacroEvent?.(detected)
        }
      } else if (macroRef.current) {
        macroRef.current = false
        setMacroWarning(false)
        onMacroEvent?.(false)
      }
    } catch {
      setError('News temporarily unavailable')
    } finally {
      setLoading(false)
    }
  }, [onMacroEvent])

  useEffect(() => {
    fetchNews()

    function tick() {
      const inHours = isNewsMarketHours()
      setIsLive(inHours)
      const requiredInterval = inHours ? 60_000 : 5 * 60_000
      if (Date.now() - lastFetchRef.current >= requiredInterval) {
        fetchNews()
      }
    }

    // Poll every minute; fetchNews only fires when interval elapsed
    intervalRef.current = setInterval(tick, 60_000)
    setIsLive(isNewsMarketHours())

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchNews])

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/40">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-200">Market News</span>
          {isLive && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-gray-500 hidden sm:block">
              Updated {formatRelative(lastUpdated.toISOString())}
            </span>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="text-gray-500 hover:text-gray-300 transition md:hidden"
            aria-label={collapsed ? 'Expand news' : 'Collapse news'}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Macro event warning */}
      {macroWarning && !collapsed && (
        <div className="flex items-start gap-3 bg-red-500/10 border-b border-red-500/30 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 font-medium leading-relaxed">
            Macro event detected in secondary window — gate closed.
          </p>
        </div>
      )}

      {/* Body — hidden on mobile when collapsed */}
      <div className={cn('divide-y divide-gray-700/30', collapsed ? 'hidden md:block' : 'block')}>
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-gray-500">Loading news...</div>
        ) : error ? (
          <div className="px-4 py-8 text-center text-xs text-gray-500">{error}</div>
        ) : articles.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-500">No recent headlines</div>
        ) : (
          articles.map((article) => (
            <a
              key={article.id}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 px-4 py-3.5 hover:bg-gray-700/20 transition group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 font-medium leading-snug line-clamp-2 group-hover:text-white transition">
                  {article.title}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
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
          ))
        )}
      </div>
    </div>
  )
}
