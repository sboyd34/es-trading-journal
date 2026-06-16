'use client'

import { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { classifyWindow, WINDOW_LABEL, type WindowStatus } from '@/lib/trade-flags'

interface Window {
  label: string
  color: 'green' | 'amber' | 'red' | 'gray'
}

// ORB windows are green (prime), builds + extended hours are amber (caution),
// the NY lunch dead zone is red. Derived from the shared classifier so the live
// banner can never drift from the journal/heatmap rules.
const WINDOW_COLOR: Record<WindowStatus, Window['color']> = {
  tokyo_orb: 'green',
  shanghai_orb: 'green',
  london_orb: 'green',
  primary: 'green',
  continuation: 'green',
  late: 'amber',
  secondary: 'amber',
  eth: 'amber',
  tokyo_build: 'amber',
  shanghai_build: 'amber',
  london_build: 'amber',
  building: 'amber',
  dead_zone: 'red',
  unknown: 'gray',
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
  const status = classifyWindow(totalMin)
  if (status === 'secondary' && macroEventDetected) {
    return { label: 'Macro event in NY secondary window — gate closed.', color: 'red' }
  }
  return { label: WINDOW_LABEL[status], color: WINDOW_COLOR[status] }
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
