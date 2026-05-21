'use client'

import { useMemo, useEffect } from 'react'
import { Trade, DailySession } from '@/types'
import { computeDisciplineScore } from '@/lib/session-grader'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface Props {
  trades: Trade[]
  session: DailySession | null
  userId: string
  date: string
}

const CIRCUMFERENCE = 2 * Math.PI * 30

function ringColor(score: number): string {
  if (score >= 90) return '#10b981'
  if (score >= 70) return '#f59e0b'
  return '#ef4444'
}

function scoreColorClass(score: number): string {
  if (score >= 90) return 'text-emerald-400'
  if (score >= 70) return 'text-amber-400'
  return 'text-red-400'
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'Good session'
  if (score >= 70) return 'Solid'
  return 'Needs work'
}

function cellIcon(pts: number): string {
  if (pts === 25) return '✅'
  if (pts === 0) return '❌'
  return '⚠️'
}

function cellColorClass(pts: number): string {
  if (pts === 25) return 'text-emerald-400'
  if (pts === 0) return 'text-red-400'
  return 'text-amber-400'
}

export default function DisciplineScoreCard({ trades, session, userId, date }: Props) {
  const { score, breakdown } = useMemo(
    () => computeDisciplineScore(trades, session),
    [trades, session],
  )

  useEffect(() => {
    if (trades.length === 0) return
    const supabase = createClient()
    supabase.from('daily_sessions').upsert(
      {
        user_id: userId,
        date,
        discipline_score: score,
        discipline_breakdown: breakdown,
      },
      { onConflict: 'user_id,date' },
    )
  }, [score, breakdown, userId, date, trades.length])

  if (trades.length === 0) return null

  const dashOffset = CIRCUMFERENCE * (1 - score / 100)
  const color = ringColor(score)

  const cells = [
    { label: 'Setup', pts: breakdown.setup },
    { label: 'Emotion', pts: breakdown.emotion },
    { label: 'Prep', pts: breakdown.prep },
    { label: 'Grade', pts: breakdown.grade },
  ]

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-white">Discipline Score</p>
        <p className="text-xs text-gray-500">Today · auto-saved</p>
      </div>

      <div className="flex items-center gap-5 mb-4">
        <div className="relative w-[72px] h-[72px] flex-shrink-0">
          <svg viewBox="0 0 72 72" width="72" height="72">
            <circle
              cx="36" cy="36" r="30"
              fill="none"
              stroke="#374151"
              strokeWidth="6"
            />
            <circle
              cx="36" cy="36" r="30"
              fill="none"
              stroke={color}
              strokeWidth="6"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform="rotate(-90 36 36)"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={cn('text-lg font-bold', scoreColorClass(score))}>{score}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">out of 100</p>
          <p className={cn('text-sm font-semibold', scoreColorClass(score))}>
            {scoreLabel(score)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {cells.map(({ label, pts }) => (
          <div
            key={label}
            className="bg-gray-800 rounded-xl px-3 py-2 flex items-center gap-2"
          >
            <span className="text-base leading-none">{cellIcon(pts)}</span>
            <div>
              <p className="text-[10px] text-gray-400">{label}</p>
              <p className={cn('text-xs font-bold', cellColorClass(pts))}>
                {pts}/25
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
