'use client'

import { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Window {
  label: string
  color: 'green' | 'amber' | 'red' | 'gray'
}

function getCTMinutes(): number {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return hour * 60 + minute
}

function getCTTimeString(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())
}

function getWindow(totalMin: number, macroEventDetected = false): Window {
  if (totalMin < 510) return { label: 'Pre-market. Prepare only.', color: 'gray' }
  if (totalMin < 525) return { label: 'Building opening range. No trades.', color: 'amber' }
  if (totalMin < 570) return { label: 'Primary ORB window.', color: 'green' }
  if (totalMin < 630) return { label: 'Continuation window.', color: 'green' }
  if (totalMin < 660) return { label: 'A+ setups only.', color: 'amber' }
  if (totalMin < 750) return { label: 'Dead zone. No trades.', color: 'red' }
  if (totalMin < 840) {
    if (macroEventDetected) {
      return { label: 'Macro event detected in secondary window — gate closed.', color: 'red' }
    }
    return { label: 'Secondary window — verify all three gates.', color: 'amber' }
  }
  return { label: 'Session closed.', color: 'red' }
}

const colorMap = {
  green: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
    badge: 'bg-emerald-500/10 border-emerald-500/30',
    label: 'text-emerald-300',
  },
  amber: {
    dot: 'bg-amber-500',
    text: 'text-amber-400',
    badge: 'bg-amber-500/10 border-amber-500/30',
    label: 'text-amber-300',
  },
  red: {
    dot: 'bg-red-500',
    text: 'text-red-400',
    badge: 'bg-red-500/10 border-red-500/30',
    label: 'text-red-300',
  },
  gray: {
    dot: 'bg-gray-500',
    text: 'text-gray-400',
    badge: 'bg-gray-500/10 border-gray-600/30',
    label: 'text-gray-400',
  },
}

interface TradingWindowIndicatorProps {
  macroEventDetected?: boolean
}

export default function TradingWindowIndicator({ macroEventDetected = false }: TradingWindowIndicatorProps) {
  const [ctTime, setCtTime] = useState('')
  const [window, setWindow] = useState<Window>({ label: 'Loading...', color: 'gray' })

  useEffect(() => {
    function update() {
      setCtTime(getCTTimeString())
      setWindow(getWindow(getCTMinutes(), macroEventDetected))
    }
    update()
    const id = setInterval(update, 60_000)
    return () => clearInterval(id)
  }, [macroEventDetected])

  const c = colorMap[window.color]

  return (
    <div className={cn('flex items-center gap-3 rounded-xl border px-4 py-3', c.badge)}>
      <Clock className={cn('h-4 w-4 shrink-0', c.text)} />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className={cn('text-sm font-semibold whitespace-nowrap', c.text)}>{ctTime} CT</span>
        <span className="text-gray-600">·</span>
        <span className={cn('text-sm font-medium truncate', c.label)}>{window.label}</span>
      </div>
      <span className={cn('h-2 w-2 rounded-full shrink-0 animate-pulse', c.dot)} />
    </div>
  )
}
