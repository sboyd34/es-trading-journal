'use client'

import { Check, X, Minus, Flame, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'
import type { BehaviorStats } from '@/lib/behavior-stats'
import { formatCurrency, cn } from '@/lib/utils'

interface BehaviorPatternsSectionProps {
  stats: BehaviorStats
}

/**
 * Renders the "Behavior Patterns This Week" section for /weekly-review.
 *
 * Spec: docs/superpowers/specs/2026-05-26-behavior-patterns-design.md
 */
export default function BehaviorPatternsSection({ stats }: BehaviorPatternsSectionProps) {
  const { days, ritualCompletion, eodCompletion, pnlClassCounts, currentStreak, ritualDelta, eodDelta } = stats

  const ritualPct = ritualCompletion.total > 0
    ? Math.round((ritualCompletion.done / ritualCompletion.total) * 100)
    : 0

  return (
    <section className="rounded-xl border border-gray-700/50 bg-gray-800/30 p-6 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-100">Behavior Patterns This Week</h2>
        <p className="text-sm italic text-gray-400 mt-1">
          Discipline counts, not P&amp;L. Where did the plan hold?
        </p>
      </div>

      {/* Day grid — horizontal scroll on mobile */}
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left font-medium pb-2 pr-3"></th>
              {days.map((d) => (
                <th key={d.date} className="text-center font-medium pb-2 px-2">
                  {d.dayOfWeek}
                </th>
              ))}
              <th className="text-right font-medium pb-2 pl-3">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-700/30">
              <td className="py-2 pr-3 text-gray-300">Ritual</td>
              {days.map((d) => (
                <td key={d.date} className="text-center py-2 px-2">
                  <CompletionIcon completed={d.ritualCompleted} />
                </td>
              ))}
              <td className="py-2 pl-3 text-right text-gray-200 font-medium">
                {ritualCompletion.done}/{ritualCompletion.total} ({ritualPct}%)
              </td>
            </tr>
            <tr className="border-t border-gray-700/30">
              <td className="py-2 pr-3 text-gray-300">EOD Review</td>
              {days.map((d) => (
                <td key={d.date} className="text-center py-2 px-2">
                  {d.eodCompleted === null ? (
                    <Minus className="h-4 w-4 text-gray-600 inline-block" aria-label="No trades" />
                  ) : (
                    <CompletionIcon completed={d.eodCompleted} />
                  )}
                </td>
              ))}
              <td className="py-2 pl-3 text-right text-gray-200 font-medium">
                {eodCompletion.done}/{eodCompletion.total} traded
              </td>
            </tr>
            <tr className="border-t border-gray-700/30">
              <td className="py-2 pr-3 text-gray-300">P&amp;L</td>
              {days.map((d) => (
                <td key={d.date} className="text-center py-2 px-2 text-xs font-mono">
                  {d.netPnL === null ? (
                    <span className="text-gray-600">—</span>
                  ) : (
                    <span className={cn(
                      d.pnlClass === 'win' && 'text-emerald-300',
                      d.pnlClass === 'loss' && 'text-red-300',
                      d.pnlClass === 'breakeven' && 'text-gray-400',
                    )}>
                      {formatCurrency(d.netPnL)}
                    </span>
                  )}
                </td>
              ))}
              <td className="py-2 pl-3 text-right text-gray-200 font-medium">
                {pnlClassCounts.win}W / {pnlClassCounts.loss}L
                {pnlClassCounts.breakeven > 0 ? ` / ${pnlClassCounts.breakeven}BE` : ''}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Streak + deltas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <StreakCallout streak={currentStreak} />
        <DeltaCallout ritualDelta={ritualDelta} eodDelta={eodDelta} />
      </div>
    </section>
  )
}

function CompletionIcon({ completed }: { completed: boolean }) {
  return completed ? (
    <Check className="h-4 w-4 text-emerald-400 inline-block" aria-label="Done" />
  ) : (
    <X className="h-4 w-4 text-red-400 inline-block" aria-label="Missed" />
  )
}

function StreakCallout({ streak }: { streak: number }) {
  const tone = streak >= 3
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    : streak >= 1
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
    : 'border-gray-700 bg-gray-900/40 text-gray-400'

  return (
    <div className={cn('rounded-lg border p-3 flex items-center gap-3', tone)}>
      <Flame className="h-5 w-5 flex-shrink-0" />
      <div>
        <p className="text-xs font-medium uppercase tracking-wider opacity-80">Discipline streak</p>
        <p className="text-base font-semibold mt-0.5">
          {streak} {streak === 1 ? 'day' : 'days'}
        </p>
      </div>
    </div>
  )
}

function DeltaCallout({ ritualDelta, eodDelta }: { ritualDelta: number; eodDelta: number }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 space-y-1">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Week-over-week</p>
      <DeltaLine label="Ritual" delta={ritualDelta} />
      <DeltaLine label="EOD" delta={eodDelta} />
    </div>
  )
}

function DeltaLine({ label, delta }: { label: string; delta: number }) {
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : ArrowRight
  const tone = delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-red-300' : 'text-gray-400'
  const sign = delta > 0 ? '+' : ''
  const labelText = delta === 0 ? 'unchanged' : `${sign}${delta} vs last week`
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={cn('h-3.5 w-3.5', tone)} />
      <span className="text-gray-300">{label}:</span>
      <span className={tone}>{labelText}</span>
    </div>
  )
}
