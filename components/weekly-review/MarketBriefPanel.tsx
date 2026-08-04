'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Newspaper, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'

// Mirrors the page's own date helpers. Kept local so the panel is
// self-contained and the page change stays a single line.
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  next.setUTCDate(next.getUTCDate() + n)
  return isoDate(next)
}

function currentMonday(): string {
  const now = new Date()
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const day = utc.getUTCDay()
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return isoDate(utc)
}

export default function MarketBriefPanel({ weekStart }: { weekStart: string }) {
  const supabase = createClient()
  const [briefText, setBriefText] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('weekly_market_briefs')
      .select('brief_text')
      .eq('week_start_date', weekStart)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setBriefText(data?.brief_text ?? null)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [supabase, weekStart])

  if (loading) return null

  // Silent for past and far-future weeks — a missing brief there is expected,
  // not a fault. Loud for the current week and the next one, because that is
  // exactly where a sleeping Mac or a failed Sunday run would otherwise be
  // invisible.
  if (!briefText) {
    const monday = currentMonday()
    const inWarnRange = weekStart === monday || weekStart === addDays(monday, 7)
    if (!inWarnRange) return null
    return (
      <section className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">
            Market brief missing
          </h2>
        </div>
        <p className="mt-2 text-sm text-gray-400">
          No weekly market brief for this week. The Sunday 08:00 CT job may not have run —
          check <code className="text-gray-300">briefs/launchd_weekly_error.log</code>.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-gray-600 bg-black/40 p-5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-300">
            Market brief — week recap &amp; week ahead
          </h2>
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-gray-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-500" />
        )}
      </button>
      {expanded && (
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-300">
          {briefText}
        </pre>
      )}
    </section>
  )
}
