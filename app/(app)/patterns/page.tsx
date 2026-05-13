'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Brain, Sparkles, AlertTriangle, CheckCircle, Target, TrendingUp, Clock, Shield } from 'lucide-react'
import toast from 'react-hot-toast'

interface Pattern {
  title: string
  type: 'behavioral' | 'statistical' | 'timing' | 'risk'
  severity: 'positive' | 'warning' | 'critical'
  finding: string
  recommendation: string
}

interface Analysis {
  summary: string
  patterns: Pattern[]
  strengths: string[]
  blind_spots: string[]
  priority_focus: string
}

const typeIcon = {
  behavioral: Brain,
  statistical: TrendingUp,
  timing: Clock,
  risk: Shield,
}

const typeLabel = {
  behavioral: 'Behavioral',
  statistical: 'Statistical',
  timing: 'Timing',
  risk: 'Risk',
}

const severityStyle = {
  positive: 'border-emerald-500/40 bg-emerald-500/5',
  warning: 'border-amber-500/40 bg-amber-500/5',
  critical: 'border-red-500/40 bg-red-500/5',
}

const severityBadge = {
  positive: 'bg-emerald-500/20 text-emerald-400',
  warning: 'bg-amber-500/20 text-amber-400',
  critical: 'bg-red-500/20 text-red-400',
}

export default function PatternsPage() {
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [tradeCount, setTradeCount] = useState(0)

  async function runAnalysis() {
    setLoading(true)
    setAnalysis(null)
    try {
      const res = await fetch('/api/claude/patterns', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Analysis failed')
      }
      const data = await res.json()
      setAnalysis(data.analysis)
      setTradeCount(data.tradeCount)
      toast.success('Analysis complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Brain className="h-6 w-6 text-purple-400" />
            AI Pattern Detection
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Analyze your full trade history to surface behavioral and statistical patterns.
          </p>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition"
        >
          <Sparkles className="h-4 w-4" />
          {loading ? 'Analyzing...' : analysis ? 'Re-Analyze' : 'Run Analysis'}
        </button>
      </div>

      {/* Empty / loading state */}
      {!analysis && !loading && (
        <div className="bg-gray-800/30 border border-gray-700/50 border-dashed rounded-xl p-12 text-center">
          <Brain className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 font-medium">No analysis yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Click &ldquo;Run Analysis&rdquo; to have Claude examine your trade history for patterns.
          </p>
          <p className="text-gray-700 text-xs mt-3">Requires at least 5 trades in your journal.</p>
        </div>
      )}

      {loading && (
        <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl p-12 text-center">
          <div className="inline-flex items-center gap-3 text-purple-400">
            <Sparkles className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">Claude is analyzing your trade history...</span>
          </div>
          <p className="text-gray-600 text-xs mt-3">This may take 10–20 seconds.</p>
        </div>
      )}

      {/* Analysis results */}
      {analysis && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="bg-purple-500/5 border border-purple-500/30 rounded-xl p-5">
            <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">
              Trader Profile — {tradeCount} trades analyzed
            </p>
            <p className="text-gray-200 text-sm leading-relaxed">{analysis.summary}</p>
          </div>

          {/* Priority focus */}
          <div className="bg-amber-500/5 border border-amber-500/40 rounded-xl p-4 flex items-start gap-3">
            <Target className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">Priority Focus</p>
              <p className="text-sm text-amber-200">{analysis.priority_focus}</p>
            </div>
          </div>

          {/* Patterns grid */}
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              Detected Patterns ({analysis.patterns.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {analysis.patterns.map((pattern, i) => {
                const Icon = typeIcon[pattern.type] || Brain
                return (
                  <div
                    key={i}
                    className={cn('border rounded-xl p-4 space-y-3', severityStyle[pattern.severity])}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-gray-400 shrink-0" />
                        <h3 className="text-sm font-semibold text-gray-200">{pattern.title}</h3>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', severityBadge[pattern.severity])}>
                          {pattern.severity}
                        </span>
                        <span className="text-xs text-gray-600">{typeLabel[pattern.type]}</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300 leading-relaxed">{pattern.finding}</p>
                    <div className="border-t border-gray-700/50 pt-2.5">
                      <p className="text-xs font-medium text-gray-500 mb-1">Recommendation</p>
                      <p className="text-xs text-gray-400 leading-relaxed">{pattern.recommendation}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Strengths & blind spots */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-400">Strengths</h3>
              </div>
              <ul className="space-y-2">
                {analysis.strengths.map((s, i) => (
                  <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                    <span className="text-emerald-500 mt-0.5">•</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-amber-400">Blind Spots</h3>
              </div>
              <ul className="space-y-2">
                {analysis.blind_spots.map((s, i) => (
                  <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-xs text-gray-700">
            Analysis powered by Claude. Re-run as you add more trades to get updated insights.
          </p>
        </div>
      )}
    </div>
  )
}
