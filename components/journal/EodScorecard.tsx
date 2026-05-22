'use client'

import { useEffect, useMemo, useState } from 'react'
import { Trade, EndOfDaySummary, DisciplineBreakdown, DailySession } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Sparkles, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  trades: Trade[]
  defaultDate?: string
}

const SUMMARY_LABELS: Record<keyof EndOfDaySummary, string> = {
  what_happened: 'What Happened',
  trades_review: 'Trades Review',
  emotional_state: 'Emotional State',
  mistakes: 'Mistakes',
  wins: 'Wins',
  lesson: 'Lesson',
  tomorrow_focus: "Tomorrow's Focus",
}

const SUMMARY_KEYS: (keyof EndOfDaySummary)[] = [
  'what_happened',
  'trades_review',
  'emotional_state',
  'mistakes',
  'wins',
  'lesson',
  'tomorrow_focus',
]

const SLIDER_LABELS: { key: keyof DisciplineBreakdown; label: string; desc: string }[] = [
  { key: 'setup', label: 'Setup Quality', desc: 'Did you wait for a valid setup from the priority list?' },
  { key: 'emotion', label: 'Emotional Control', desc: 'Were you calm, flat, and non-reactive throughout?' },
  { key: 'prep', label: 'Preparation', desc: 'Did you complete pre-market prep and know your plan?' },
  { key: 'grade', label: 'Grade Adherence', desc: 'Did your trade grades reflect honest self-assessment?' },
]

function scoreColor(total: number): string {
  if (total >= 85) return 'text-emerald-400'
  if (total >= 70) return 'text-amber-400'
  return 'text-red-400'
}

export default function EodScorecard({ trades, defaultDate }: Props) {
  const supabase = createClient()

  const tradingDates = useMemo(() => {
    const dates = Array.from(new Set(trades.map((t) => t.date)))
    return dates.sort((a, b) => a.localeCompare(b))
  }, [trades])

  const [selectedDate, setSelectedDate] = useState<string>(
    defaultDate ?? tradingDates[tradingDates.length - 1] ?? ''
  )

  const currentIdx = tradingDates.indexOf(selectedDate)

  const dayStats = useMemo(() => {
    const day = trades.filter((t) => t.date === selectedDate)
    const pnl = day.reduce((s, t) => s + t.net_pnl, 0)
    const wins = day.filter((t) => t.net_pnl > 0).length
    return { count: day.length, pnl, wins, losses: day.length - wins }
  }, [trades, selectedDate])

  const [setup, setSetup] = useState(20)
  const [emotion, setEmotion] = useState(20)
  const [prep, setPrep] = useState(20)
  const [gradeAdherence, setGradeAdherence] = useState(20)
  const [summary, setSummary] = useState<EndOfDaySummary | null>(null)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [emotionScore, setEmotionScore] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [existingSessionId, setExistingSessionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const disciplineTotal = setup + emotion + prep + gradeAdherence

  useEffect(() => {
    if (!selectedDate) return
    let cancelled = false

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const { data } = await supabase
        .from('daily_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', selectedDate)
        .maybeSingle()

      if (cancelled) return

      if (data) {
        const session = data as DailySession
        setExistingSessionId(session.id)
        if (session.discipline_breakdown) {
          setSetup(session.discipline_breakdown.setup ?? 20)
          setEmotion(session.discipline_breakdown.emotion ?? 20)
          setPrep(session.discipline_breakdown.prep ?? 20)
          setGradeAdherence(session.discipline_breakdown.grade ?? 20)
        } else {
          setSetup(20); setEmotion(20); setPrep(20); setGradeAdherence(20)
        }
        setSummary(session.end_of_day_summary)
        setEmotionScore(session.emotion_score)
        setNotes(session.notes ?? '')
      } else {
        setExistingSessionId(null)
        setSetup(20); setEmotion(20); setPrep(20); setGradeAdherence(20)
        setSummary(null)
        setEmotionScore(null)
        setNotes('')
      }
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  if (trades.length === 0) return null

  const goPrev = () => { if (currentIdx > 0) setSelectedDate(tradingDates[currentIdx - 1]) }
  const goNext = () => { if (currentIdx < tradingDates.length - 1) setSelectedDate(tradingDates[currentIdx + 1]) }

  async function handleGenerateSummary() {
    setGeneratingSummary(true)
    try {
      const res = await fetch('/api/claude/daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: selectedDate }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error((err as { error?: string }).error ?? 'Failed to generate summary')
        return
      }
      const data = await res.json() as { summary: EndOfDaySummary }
      setSummary(data.summary)
    } catch {
      toast.error('Network error generating summary')
    } finally {
      setGeneratingSummary(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { toast.error('Not authenticated'); return }

      const payload = {
        user_id: user.id,
        date: selectedDate,
        discipline_score: disciplineTotal,
        discipline_breakdown: { setup, emotion, prep, grade: gradeAdherence },
        end_of_day_summary: summary,
        emotion_score: emotionScore,
        notes: notes || null,
      }

      if (existingSessionId) {
        const { error } = await supabase
          .from('daily_sessions')
          .update(payload)
          .eq('id', existingSessionId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('daily_sessions')
          .insert(payload)
          .select('id')
          .single()
        if (error) throw error
        setExistingSessionId((data as { id: string }).id)
      }

      toast.success('Scorecard saved')
    } catch (err) {
      console.error('Save error:', err)
      toast.error('Failed to save scorecard')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Date Navigator */}
      <div className="flex items-center gap-3">
        <button
          onClick={goPrev}
          disabled={currentIdx <= 0}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-white min-w-[120px] text-center">
          {selectedDate ? format(parseISO(selectedDate), 'MMM d, yyyy') : '—'}
        </span>
        <button
          onClick={goNext}
          disabled={currentIdx >= tradingDates.length - 1}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed transition"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day Stats */}
      {dayStats.count > 0 ? (
        <div className="flex items-center gap-6 text-sm">
          <span className="text-gray-400">{dayStats.count} trade{dayStats.count !== 1 ? 's' : ''}</span>
          <span className={dayStats.pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
            {formatCurrency(dayStats.pnl)}
          </span>
          <span className="text-gray-500">{dayStats.wins}W / {dayStats.losses}L</span>
        </div>
      ) : (
        <p className="text-sm text-gray-500">No trades on this date — you can still log a scorecard.</p>
      )}

      {/* Discipline Scorecard */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-200">Discipline Scorecard</p>
          <span className={cn('text-2xl font-bold tabular-nums', scoreColor(disciplineTotal))}>
            {disciplineTotal}<span className="text-sm text-gray-600 font-normal"> / 100</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {SLIDER_LABELS.map(({ key, label, desc }) => {
            const val = key === 'setup' ? setup : key === 'emotion' ? emotion : key === 'prep' ? prep : gradeAdherence
            const setter = key === 'setup' ? setSetup : key === 'emotion' ? setEmotion : key === 'prep' ? setPrep : setGradeAdherence
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-300">{label}</label>
                  <span className="text-xs font-bold text-white tabular-nums">{val}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={25}
                  step={1}
                  value={val}
                  onChange={(e) => setter(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full accent-blue-500 cursor-pointer"
                />
                <p className="text-[10px] text-gray-600">{desc}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Session Summary */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-200">Session Summary</p>
          <button
            onClick={handleGenerateSummary}
            disabled={generatingSummary || dayStats.count === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {generatingSummary ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5" /> {summary ? 'Regenerate' : 'Generate AI Summary'}</>
            )}
          </button>
        </div>

        {dayStats.count === 0 && !summary && (
          <p className="text-xs text-gray-600">Import or annotate trades for this date to generate an AI summary.</p>
        )}

        <div className="space-y-3">
          {SUMMARY_KEYS.map((key) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {SUMMARY_LABELS[key]}
              </label>
              <textarea
                rows={2}
                value={summary?.[key] ?? ''}
                onChange={(e) => setSummary((prev) => ({
                  ...(prev ?? {} as EndOfDaySummary),
                  [key]: e.target.value,
                }))}
                placeholder={`Enter ${SUMMARY_LABELS[key].toLowerCase()}…`}
                className="w-full bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Emotion & Notes */}
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-200">Emotion & Notes</p>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">
            Emotion Score <span className="text-gray-600">(1 = worst, 10 = best)</span>
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                onClick={() => setEmotionScore(emotionScore === n ? null : n)}
                className={cn(
                  'w-8 h-8 rounded-lg text-xs font-semibold transition',
                  emotionScore === n
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700'
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything else about today's session…"
            className="w-full bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {saving
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            : 'Save Scorecard'
          }
        </button>
      </div>
    </div>
  )
}
