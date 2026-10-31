'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

const LS_KEY = 'apex.eval.lastResult'

interface LastRun {
  passProb: number
  passProbCI?: [number, number]
  verdict?: 'adequate' | 'directional' | 'insufficient'
  riskPerTrade: number
  runAt: string
}

function passProbColor(p: number): string {
  if (p >= 60) return 'text-emerald-400'
  if (p >= 35) return 'text-amber-400'
  return 'text-red-400'
}

export default function EvalPassOddsCard() {
  const router = useRouter()
  const [lastRun, setLastRun] = useState<LastRun | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) setLastRun(JSON.parse(raw) as LastRun)
    } catch {
      // ignore malformed localStorage entry
    }
  }, [])

  if (!lastRun) return null

  const runDate = new Date(lastRun.runAt)
  const daysAgo = Math.floor((Date.now() - runDate.getTime()) / (1000 * 60 * 60 * 24))
  const ageLabel = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Eval Pass Odds</p>
        {lastRun.verdict === 'insufficient' || !lastRun.verdict ? (
          <>
            <p className="text-2xl font-bold text-gray-400 mt-0.5">
              {lastRun.passProbCI
                ? `${lastRun.passProbCI[0].toFixed(0)}–${lastRun.passProbCI[1].toFixed(0)}%`
                : '—'}
            </p>
            <span className="inline-block mt-1 text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-semibold">
              needs more data
            </span>
          </>
        ) : (
          <p className={cn('text-3xl font-bold tabular-nums mt-0.5', passProbColor(lastRun.passProb))}>
            {lastRun.passProb.toFixed(1)}%
          </p>
        )}
        <p className="text-[10px] text-gray-600 mt-1">
          ${lastRun.riskPerTrade}/trade · {ageLabel}
        </p>
      </div>
      <button
        onClick={() => router.push('/backtest/eval')}
        className="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-300 text-xs font-semibold rounded-lg transition whitespace-nowrap"
      >
        Rerun →
      </button>
    </div>
  )
}
