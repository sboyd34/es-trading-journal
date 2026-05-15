'use client'

import { useEffect, useState } from 'react'
import { Trade, TradeAiNarrative } from '@/types'
import { Sparkles, CheckCircle, XCircle, Lightbulb, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  trade: Trade
  onUpdated?: (trade: Trade) => void
}

export default function TradeNarrativePanel({ trade, onUpdated }: Props) {
  const [narrative, setNarrative] = useState<TradeAiNarrative | null>(trade.ai_narrative || null)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    setNarrative(trade.ai_narrative || null)
  }, [trade.id, trade.ai_narrative])

  async function generate() {
    setGenerating(true)
    try {
      const res = await fetch(`/api/trades/${trade.id}/narrative`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to generate narrative')
      }
      const data = await res.json()
      setNarrative(data.narrative as TradeAiNarrative)
      toast.success('Narrative generated')
      onUpdated?.({ ...trade, ai_narrative: data.narrative })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setGenerating(false)
    }
  }

  if (!narrative && !generating) {
    return (
      <div className="bg-gray-900/40 border border-gray-700/40 border-dashed rounded-xl p-8 text-center">
        <Sparkles className="h-10 w-10 text-purple-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-300 mb-1">No narrative yet for this trade</p>
        <p className="text-xs text-gray-500 mb-4 max-w-md mx-auto">
          Claude will read the trade facts (timing, location, MFE/MAE, news, setup tag, mood) and write a coach-style review against your rules.
        </p>
        <button
          onClick={generate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-lg transition"
        >
          <Sparkles className="h-4 w-4" />
          Generate Narrative
        </button>
      </div>
    )
  }

  if (generating && !narrative) {
    return (
      <div className="bg-gray-900/40 border border-gray-700/40 rounded-xl p-8 text-center">
        <div className="inline-flex items-center gap-3 text-purple-400">
          <Sparkles className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Claude is reviewing this trade…</span>
        </div>
        <p className="text-xs text-gray-500 mt-2">10–15 seconds</p>
      </div>
    )
  }

  if (!narrative) return null

  return (
    <div className="space-y-4">
      {/* Narrative paragraph */}
      <div className="bg-purple-500/5 border border-purple-500/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Coach&apos;s Review</p>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw className={generating ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
            {generating ? 'Re-generating…' : 'Re-generate'}
          </button>
        </div>
        <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{narrative.narrative}</p>
      </div>

      {/* Right / wrong */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {narrative.what_went_right.length > 0 && (
          <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5" /> What Went Right
            </h3>
            <ul className="space-y-1.5">
              {narrative.what_went_right.map((item, i) => (
                <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                  <span className="text-emerald-400 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
        {narrative.what_went_wrong.length > 0 && (
          <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <XCircle className="h-3.5 w-3.5" /> What Went Wrong
            </h3>
            <ul className="space-y-1.5">
              {narrative.what_went_wrong.map((item, i) => (
                <li key={i} className="text-xs text-gray-300 flex items-start gap-1.5">
                  <span className="text-red-400 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Key lesson */}
      {narrative.key_lesson && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
          <Lightbulb className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">Key Lesson</p>
            <p className="text-sm text-amber-100">{narrative.key_lesson}</p>
          </div>
        </div>
      )}

      <p className="text-[10px] text-gray-600 text-right">
        Generated {new Date(narrative.generated_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
    </div>
  )
}
