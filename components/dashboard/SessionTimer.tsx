'use client'

import { useState, useEffect } from 'react'
import { Trade } from '@/types'
import { cn } from '@/lib/utils'
import { Timer, AlertTriangle, OctagonX } from 'lucide-react'

const AMBER_MS = 90 * 60 * 1000
const RED_MS = 120 * 60 * 1000

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function SessionTimer({ todayTrades }: { todayTrades: Trade[] }) {
  const [elapsed, setElapsed] = useState(0)

  const firstTradeMs = todayTrades.length > 0
    ? Math.min(...todayTrades.map(t => new Date(t.entry_time).getTime()))
    : null

  useEffect(() => {
    if (!firstTradeMs) return
    const tick = () => setElapsed(Date.now() - firstTradeMs)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [firstTradeMs])

  const isAmber = elapsed >= AMBER_MS && elapsed < RED_MS
  const isRed = elapsed >= RED_MS

  if (!firstTradeMs) {
    return (
      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl px-5 py-3 flex items-center gap-3">
        <Timer className="h-4 w-4 text-gray-500 shrink-0" />
        <span className="text-sm text-gray-500">Session timer — no trades today</span>
      </div>
    )
  }

  return (
    <div className={cn(
      'border rounded-xl px-5 py-3 flex items-center gap-4 transition',
      isRed
        ? 'border-red-500/50 bg-red-500/8'
        : isAmber
        ? 'border-amber-500/50 bg-amber-500/8'
        : 'border-gray-700/50 bg-gray-800/50'
    )}>
      {isRed
        ? <OctagonX className="h-5 w-5 text-red-400 shrink-0" />
        : isAmber
        ? <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
        : <Timer className="h-5 w-5 text-gray-400 shrink-0" />}

      <div className="flex items-baseline gap-3 flex-1">
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Session</span>
        <span className={cn(
          'text-xl font-mono font-bold tabular-nums',
          isRed ? 'text-red-400' : isAmber ? 'text-amber-400' : 'text-white'
        )}>
          {formatElapsed(elapsed)}
        </span>
      </div>

      {isRed && (
        <div className="text-right">
          <p className="text-xs font-bold text-red-400">STOP TRADING</p>
          <p className="text-xs text-red-400/70">Over 2 hours — fatigue impairs judgement</p>
        </div>
      )}
      {isAmber && (
        <div className="text-right">
          <p className="text-xs font-bold text-amber-400">CONSIDER STOPPING</p>
          <p className="text-xs text-amber-400/70">Over 90 min — wrap up your session</p>
        </div>
      )}
    </div>
  )
}
