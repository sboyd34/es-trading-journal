'use client'

import { useState, useMemo } from 'react'
import { Trade } from '@/types'
import { cn, formatCurrency } from '@/lib/utils'
import { ShieldCheck, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { SYSTEM_SETUPS, SYSTEM_LOCATIONS } from '@/lib/trading-system'
import { classifyWindow } from '@/lib/trade-flags'

export interface GateAnswers {
  bias: 'Bull' | 'Bear' | 'Neutral'
  setup: string
  trigger: string
  location: string
  risk: string
  inPlan: boolean
}

interface FiveWordGateModalProps {
  trade?: Trade
  trades?: Trade[]
  onComplete: (answers: GateAnswers) => void
  onCancel: () => void
}

function matchesSetup(t: Trade, setupName: string): boolean {
  if (!setupName) return false
  const haystack = [t.trade_setup, t.setup_tag].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(setupName.toLowerCase())
}

function ctWindowFromTime(isoTime: string): string {
  try {
    const d = new Date(isoTime)
    const s = d.toLocaleTimeString('en-US', {
      timeZone: 'America/Chicago',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })
    const [h, m] = s.split(':').map(Number)
    return classifyWindow(h * 60 + m)
  } catch {
    return 'unknown'
  }
}

interface ProbScore {
  wins: number
  total: number
  tier: 'full' | 'no-window' | 'setup-only'
  label: string
}

export default function FiveWordGateModal({ trade, trades = [], onComplete, onCancel }: FiveWordGateModalProps) {
  const [bias, setBias] = useState<'Bull' | 'Bear' | 'Neutral' | null>(
    (trade?.trade_bias as 'Bull' | 'Bear' | 'Neutral' | null) ?? null
  )
  const [setup, setSetup] = useState(trade?.trade_setup ?? '')
  const [trigger, setTrigger] = useState(trade?.trade_trigger ?? '')
  const [location, setLocation] = useState(trade?.trade_location ?? '')
  const [risk, setRisk] = useState(trade?.trade_risk ?? '')
  const [inPlan, setInPlan] = useState<boolean | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  const allFilled = bias !== null && setup !== '' && trigger.trim() !== '' && location !== '' && risk.trim() !== '' && inPlan !== null
  const canProceed = allFilled && confirmed

  function handleContinue() {
    if (!canProceed) return
    onComplete({ bias: bias!, setup, trigger, location, risk, inPlan: inPlan! })
  }

  const filledCount = [bias !== null, setup !== '', trigger.trim() !== '', location !== '', risk.trim() !== ''].filter(Boolean).length

  // Probability score: computed as soon as setup + bias are selected
  const probScore = useMemo<ProbScore | null>(() => {
    if (!setup || !bias || trades.length === 0) return null

    const setupMatches = trades.filter((t) => matchesSetup(t, setup))
    if (setupMatches.length === 0) return null

    // Determine current time window
    const nowWindow = ctWindowFromTime(new Date().toISOString())

    // Tier 1: setup + bias + window (most specific)
    const tier1 = setupMatches.filter(
      (t) => (t.trade_bias ?? '').toLowerCase() === bias.toLowerCase() &&
              ctWindowFromTime(t.entry_time) === nowWindow,
    )
    if (tier1.length >= 3) {
      const wins = tier1.filter((t) => t.net_pnl > 0).length
      const windowLabel: Record<string, string> = {
        primary: '08:45–09:30', continuation: '09:30–10:30', late: '10:30–11:00',
        secondary: '12:30–14:00', building: 'pre-ORB', dead_zone: 'dead zone', closed: 'after-hours',
      }
      return {
        wins, total: tier1.length, tier: 'full',
        label: `${setup} · ${bias} bias · ${windowLabel[nowWindow] ?? nowWindow} window`,
      }
    }

    // Tier 2: setup + bias (no window filter)
    const tier2 = setupMatches.filter(
      (t) => (t.trade_bias ?? '').toLowerCase() === bias.toLowerCase(),
    )
    if (tier2.length >= 3) {
      const wins = tier2.filter((t) => t.net_pnl > 0).length
      return {
        wins, total: tier2.length, tier: 'no-window',
        label: `${setup} · ${bias} bias (all sessions)`,
      }
    }

    // Tier 3: setup only
    if (setupMatches.length >= 3) {
      const wins = setupMatches.filter((t) => t.net_pnl > 0).length
      return {
        wins, total: setupMatches.length, tier: 'setup-only',
        label: `${setup} (all biases)`,
      }
    }

    return null
  }, [setup, bias, trades])

  return (
    <div className="space-y-5">
      {/* Trade summary (only shown for existing trades) */}
      {trade && (
        <div className="bg-gray-800 rounded-lg p-3 grid grid-cols-4 gap-2 text-sm">
          <div>
            <p className="text-xs text-gray-500">Direction</p>
            <p className={cn('font-semibold', trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400')}>
              {trade.direction.toUpperCase()}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Entry</p>
            <p className="text-white font-medium">{trade.entry_price.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Exit</p>
            <p className="text-white font-medium">{trade.exit_price.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">P&L</p>
            <p className={cn('font-bold', trade.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {formatCurrency(trade.net_pnl)}
            </p>
          </div>
        </div>
      )}

      {/* Gate header */}
      <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2.5">
        <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0" />
        <span className="text-sm font-medium text-blue-300">
          Hard Operating Rule — state all five before proceeding
        </span>
      </div>

      {/* 1. Bias */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Bias</p>
        <div className="flex gap-2">
          {(['Bull', 'Bear', 'Neutral'] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBias(bias === b ? null : b)}
              className={cn(
                'flex-1 py-2 rounded-lg border text-sm font-semibold transition',
                bias === b
                  ? b === 'Bull' ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                    : b === 'Bear' ? 'border-red-500 bg-red-500/20 text-red-400'
                    : 'border-yellow-500 bg-yellow-500/20 text-yellow-300'
                  : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
              )}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Setup */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">2 · Setup</p>
        <select
          value={setup}
          onChange={(e) => setSetup(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select setup...</option>
          {SYSTEM_SETUPS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* 3. Trigger */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">3 · Trigger</p>
        <input
          type="text"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          placeholder="What was the exact 5m trigger?"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* 4. Location */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">4 · Location</p>
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select location...</option>
          {SYSTEM_LOCATIONS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>

      {/* 5. Risk */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">5 · Risk</p>
        <input
          type="text"
          value={risk}
          onChange={(e) => setRisk(e.target.value)}
          placeholder="Stop and target (e.g. stop 5812, target 5840)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* In plan? */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Was this trade in your plan?</p>
        <div className="flex gap-2">
          <button
            onClick={() => setInPlan(inPlan === true ? null : true)}
            className={cn(
              'flex-1 py-2 rounded-lg border text-sm font-semibold transition',
              inPlan === true
                ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
            )}
          >
            Yes
          </button>
          <button
            onClick={() => setInPlan(inPlan === false ? null : false)}
            className={cn(
              'flex-1 py-2 rounded-lg border text-sm font-semibold transition',
              inPlan === false
                ? 'border-red-500 bg-red-500/20 text-red-400'
                : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
            )}
          >
            No
          </button>
        </div>
        {inPlan === false && (
          <p className="text-xs text-amber-400 mt-1.5">This trade will be tagged as &ldquo;off-plan&rdquo;.</p>
        )}
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex gap-1 mb-2">
          {[bias !== null, setup !== '', trigger.trim() !== '', location !== '', risk.trim() !== ''].map((filled, i) => (
            <div
              key={i}
              className={cn('h-1 flex-1 rounded-full transition', filled ? 'bg-blue-500' : 'bg-gray-700')}
            />
          ))}
        </div>
        <p className="text-xs text-gray-500 text-right">{filledCount}/5 complete</p>
      </div>

      {/* Pre-trade probability score */}
      {probScore && (() => {
        const winRate = probScore.wins / probScore.total
        const isStrong = winRate >= 0.6
        const isWeak = winRate < 0.4
        const color = isStrong ? 'emerald' : isWeak ? 'red' : 'amber'
        const Icon = isStrong ? TrendingUp : isWeak ? TrendingDown : Minus
        return (
          <div className={cn(
            'rounded-xl border px-4 py-3.5 space-y-1.5',
            color === 'emerald' && 'border-emerald-500/30 bg-emerald-500/5',
            color === 'amber' && 'border-amber-500/30 bg-amber-500/5',
            color === 'red' && 'border-red-500/30 bg-red-500/5',
          )}>
            <div className="flex items-center gap-2">
              <Icon className={cn('h-4 w-4 shrink-0',
                color === 'emerald' && 'text-emerald-400',
                color === 'amber' && 'text-amber-400',
                color === 'red' && 'text-red-400',
              )} />
              <p className={cn('text-sm font-semibold',
                color === 'emerald' && 'text-emerald-300',
                color === 'amber' && 'text-amber-300',
                color === 'red' && 'text-red-300',
              )}>
                {probScore.wins} wins / {probScore.total} trades — {Math.round(winRate * 100)}% win rate
              </p>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              Historical edge for <span className="text-gray-200 font-medium">{probScore.label}</span>
              {probScore.tier === 'no-window' && ' — not enough data for this time window yet'}
              {probScore.tier === 'setup-only' && ' — not enough data for this bias+window combination yet'}
              . {isWeak ? 'Below-average edge — proceed only with A+ confluence.' : isStrong ? 'Strong edge. Proceed if all five gate answers are solid.' : 'Moderate edge. Confirm your location and trigger are clean.'}
            </p>
          </div>
        )
      })()}

      {/* Confirmation checkbox */}
      {allFilled && (
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-blue-500 cursor-pointer"
          />
          <span className="text-sm text-gray-300 group-hover:text-white transition leading-snug">
            {inPlan === false
              ? 'I acknowledge this was an off-plan trade and I am logging it for review.'
              : 'I can state all five clearly and this trade matches my system.'}
          </span>
        </label>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-lg border border-gray-700 text-sm font-medium text-gray-400 hover:text-white hover:border-gray-600 transition"
        >
          Cancel
        </button>
        <button
          onClick={handleContinue}
          disabled={!canProceed}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-white transition"
        >
          Continue to Annotation →
        </button>
      </div>
    </div>
  )
}
