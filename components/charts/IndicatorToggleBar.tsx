'use client'

import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { IndicatorPrefs } from '@/components/blind-backtest/CandlestickChart'

const DEFAULT_PREFS: IndicatorPrefs = { vwap: true, ema9: false, ema20: true, ema50: false }

function loadPrefs(key: string): IndicatorPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<IndicatorPrefs>
    return { ...DEFAULT_PREFS, ...parsed }
  } catch {
    return DEFAULT_PREFS
  }
}

// Reusable hook: returns [prefs, setPrefs] with localStorage persistence
// scoped to `storageKey` so different chart contexts can keep separate
// preferences (e.g. blind backtest vs. journal auto-chart).
export function useIndicatorPrefs(storageKey: string): [IndicatorPrefs, (next: IndicatorPrefs) => void] {
  const [prefs, setPrefsState] = useState<IndicatorPrefs>(DEFAULT_PREFS)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setPrefsState(loadPrefs(storageKey))
    setHydrated(true)
  }, [storageKey])

  const setPrefs = useCallback((next: IndicatorPrefs) => {
    setPrefsState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, JSON.stringify(next))
    }
  }, [storageKey])

  // Until hydrated, return defaults so SSR and CSR match
  return [hydrated ? prefs : DEFAULT_PREFS, setPrefs]
}

interface Props {
  value: IndicatorPrefs
  onChange: (next: IndicatorPrefs) => void
  className?: string
}

const CHIPS: { key: keyof IndicatorPrefs; label: string; color: string }[] = [
  { key: 'vwap',  label: 'VWAP',   color: 'bg-yellow-500'  },
  { key: 'ema9',  label: 'EMA 9',  color: 'bg-cyan-500'    },
  { key: 'ema20', label: 'EMA 20', color: 'bg-blue-500'    },
  { key: 'ema50', label: 'EMA 50', color: 'bg-orange-500'  },
]

export default function IndicatorToggleBar({ value, onChange, className }: Props) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mr-1">Indicators</span>
      {CHIPS.map((chip) => {
        const active = value[chip.key]
        return (
          <button
            key={chip.key}
            onClick={() => onChange({ ...value, [chip.key]: !active })}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition',
              active
                ? 'bg-gray-800 border-gray-600 text-white'
                : 'bg-gray-800/30 border-gray-700/50 text-gray-500 hover:text-gray-300',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', active ? chip.color : 'bg-gray-700')} />
            {chip.label}
          </button>
        )
      })}
    </div>
  )
}
