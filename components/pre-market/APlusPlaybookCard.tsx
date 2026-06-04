'use client'

import {
  Star,
  MapPin,
  ListChecks,
  Map as MapIcon,
  Crosshair,
  Shield,
  BookOpen,
  AlertTriangle,
} from 'lucide-react'
import { SYSTEM_SETUPS } from '@/lib/trading-system'

/**
 * Static "A+ Playbook" reference card for the /pre-market page.
 *
 * Surfaces the operating sequence for the ES_10x_Integrated ThinkScript
 * A+ confluence chip (volume spike + DMI/ADX trend + price near an approved
 * level, during RTH). The indicator answers "LOOK HERE" — this card is the
 * discipline that converts a look into a vetted trade.
 *
 * Mental model: A+ is a TRIGGER, not a setup. The linger window exists so you
 * validate before you fire, not fire on the chime.
 *
 * Hardcoded discipline content (same principle as BracketSpecCard and
 * THE_15_RULES in lib/preopen-ritual.ts) — changes go through code review,
 * not a settings UI. Setup names are imported from lib/trading-system.ts so
 * the card can never drift from the single source of truth.
 */

interface PlaybookStep {
  n: number
  icon: React.ReactNode
  title: string
  detail: string
}

const STEPS: PlaybookStep[] = [
  {
    n: 1,
    icon: <MapPin className="h-4 w-4" />,
    title: 'Read the location',
    detail:
      'The chart bubble already names it — PDH, PDL, ORH, ORL, WkH, or WkL. That is your "where." A+ with no named level is just noise.',
  },
  {
    n: 2,
    icon: <ListChecks className="h-4 w-4" />,
    title: 'Run the checklist',
    detail:
      'A+ only satisfies "approved location" + direction. You still owe the rest: does it map to one of the 5 setups, is 1H bias aligned (the chip is single-timeframe), and are you inside a valid time window?',
  },
  {
    n: 3,
    icon: <MapIcon className="h-4 w-4" />,
    title: 'Cross-check the maps',
    detail:
      'Pull up your supply/demand zones. When the trigger (A+) and the map (zone) agree, that is your real A+. When they fight, the map wins — that is a skip.',
  },
  {
    n: 4,
    icon: <Crosshair className="h-4 w-4" />,
    title: 'Define stop + target first',
    detail:
      'Stop beyond the level that defines the trade (the zone\'s invalidation point); target the next opposing level. You have an R-multiple before you risk a dollar.',
  },
  {
    n: 5,
    icon: <Shield className="h-4 w-4" />,
    title: 'Apex is the hard ceiling',
    detail:
      'The script sizes nothing. Predefine contracts so a full stop-out stays inside the trailing drawdown and daily loss limit. Non-negotiable boundaries.',
  },
  {
    n: 6,
    icon: <BookOpen className="h-4 w-4" />,
    title: 'Journal every A+ — taken AND skipped',
    detail:
      'A+ is a hypothesis ("volume + trend + level = edge"), not a proven edge. Blind-backtest it, then let the journal tell you the hit rate by level, setup, and window. Size up on what your data validates, not the yellow star.',
  },
]

interface AlignmentRow {
  signal: string
  signalColor: string
  aligned: string
  conflict: string
}

const ALIGNMENT: AlignmentRow[] = [
  {
    signal: 'A+ LONG',
    signalColor: 'text-emerald-300',
    aligned: 'At demand, or a blue flip zone (former supply now support)',
    conflict: 'Into a supply / orange zone — buying into resistance',
  },
  {
    signal: 'A+ SHORT',
    signalColor: 'text-red-300',
    aligned: 'At supply, or an orange flip zone (former support now resistance)',
    conflict: 'Into a demand / blue zone — selling into support',
  },
]

const GUARDRAILS: string[] = [
  'Don\'t chase a stale A+. If price already ran past the level, the edge is gone — the chip dies when price leaves, but trust your eyes too.',
  'One look per level. Missed the entry? Don\'t revenge-chase the same level (pre-open check #4).',
  'No A+ outside your windows. A perfect-looking signal at lunch lull is still a lunch-lull trade.',
  'Counter-1H-bias A+ = smaller or skip. The single-timeframe trap.',
]

export default function APlusPlaybookCard() {
  return (
    <section className="rounded-xl border border-gray-700/50 bg-gray-800/30 p-6 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          <Star className="h-5 w-5 text-yellow-400 fill-yellow-400" />
          A+ Playbook
        </h2>
        <p className="text-sm italic text-gray-400 mt-1">
          When the ★ A+ ★ chip lights up. A+ is a trigger, not a setup — it
          says <span className="text-gray-300">look here</span>, not{' '}
          <span className="text-gray-300">take this</span>.
        </p>
      </div>

      {/* The sequence */}
      <ol className="space-y-3">
        {STEPS.map((step) => (
          <li key={step.n} className="flex items-start gap-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-gray-600/60 bg-gray-900/50 text-xs font-semibold text-gray-300">
              {step.n}
            </span>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-100">
                <span className="text-yellow-400">{step.icon}</span>
                {step.title}
              </div>
              <p className="text-sm text-gray-300 leading-relaxed mt-0.5">
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {/* Setup-match reminder — A+ must resolve to one of these */}
      <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Step 2 — A+ must resolve to one of your 5 setups
        </p>
        <div className="flex flex-wrap gap-2">
          {SYSTEM_SETUPS.map((setup) => (
            <span
              key={setup}
              className="rounded-md border border-gray-600/50 bg-gray-800/60 px-2.5 py-1 text-xs font-medium text-gray-200"
            >
              {setup}
            </span>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          No setup behind the A+ = noise at a level. Pass.
        </p>
      </div>

      {/* Trigger vs. map — the cross-check table */}
      <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
          Step 3 — trigger vs. map
        </p>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-700/50 text-gray-400">
              <th className="text-left py-1.5 font-medium">Signal</th>
              <th className="text-left py-1.5 font-medium">Aligned — take it</th>
              <th className="text-left py-1.5 font-medium">Conflict — skip / shrink</th>
            </tr>
          </thead>
          <tbody>
            {ALIGNMENT.map((row) => (
              <tr key={row.signal} className="border-b border-gray-700/30 align-top">
                <td className={`py-2 pr-3 font-semibold ${row.signalColor}`}>
                  {row.signal}
                </td>
                <td className="py-2 pr-3 text-emerald-200/90">{row.aligned}</td>
                <td className="py-2 text-red-200/90">{row.conflict}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">
          When trigger and map fight, the map wins.
        </p>
      </div>

      {/* Anti-greed guardrails */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-200">
            Anti-greed guardrails
          </span>
        </div>
        <ul className="space-y-1.5">
          {GUARDRAILS.map((g, i) => (
            <li key={i} className="text-sm text-amber-100/90 leading-relaxed flex gap-2">
              <span className="text-amber-400/70 select-none">•</span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom line */}
      <p className="text-sm text-gray-300 leading-relaxed border-t border-gray-700/50 pt-4">
        <span className="font-semibold text-gray-100">Bottom line:</span> A+ says{' '}
        <span className="text-yellow-300">look</span>, your checklist + maps say{' '}
        <span className="text-gray-100">is it real</span>, structure says{' '}
        <span className="text-gray-100">where&apos;s my stop</span>, Apex says{' '}
        <span className="text-gray-100">how much</span>, and the journal says{' '}
        <span className="text-gray-100">did it actually work</span>. The script&apos;s
        job ends at <span className="text-yellow-300">look</span>.
      </p>
    </section>
  )
}
