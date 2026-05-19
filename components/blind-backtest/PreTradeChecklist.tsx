'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Check, Lock } from 'lucide-react'

const SETUPS = ['ORB', 'TTM Squeeze', 'AVWAP', 'FVG', 'Divergence'] as const

export interface ChecklistValues {
  bias: string
  setup: string
  trigger: string
  location: string
  entryPrice: string
  stopPrice: string
  targetPrice: string
  direction: 'long' | 'short' | ''
  confidence: string
}

export const EMPTY_CHECKLIST: ChecklistValues = {
  bias: '', setup: '', trigger: '', location: '',
  entryPrice: '', stopPrice: '', targetPrice: '',
  direction: '', confidence: '',
}

interface Props {
  values: ChecklistValues
  onChange: (next: ChecklistValues) => void
  onStartPlayback: () => void
  disabled?: boolean
}

function isFilled(v: string) {
  return v.trim().length > 0
}

function numericFilled(v: string) {
  return isFilled(v) && Number.isFinite(parseFloat(v))
}

export default function PreTradeChecklist({ values, onChange, onStartPlayback, disabled }: Props) {
  const pillars = useMemo(() => {
    const riskFilled = numericFilled(values.entryPrice) && numericFilled(values.stopPrice) && numericFilled(values.targetPrice)
    return [
      { key: 'bias',      label: '1. Bias',     ok: isFilled(values.bias) },
      { key: 'setup',     label: '2. Setup',    ok: isFilled(values.setup) },
      { key: 'trigger',   label: '3. Trigger',  ok: isFilled(values.trigger) },
      { key: 'location',  label: '4. Location', ok: isFilled(values.location) },
      { key: 'risk',      label: '5. Risk (entry/stop/target)', ok: riskFilled },
    ]
  }, [values])

  const allValid = pillars.every((p) => p.ok) && (values.direction === 'long' || values.direction === 'short')

  function update<K extends keyof ChecklistValues>(key: K, val: ChecklistValues[K]) {
    onChange({ ...values, [key]: val })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm text-gray-300">
          <Lock className="h-4 w-4" />
          <span>Cannot state all five = no trade. Period.</span>
        </div>
        <ul className="space-y-1 text-sm">
          {pillars.map((p) => (
            <li key={p.key} className={cn('flex items-center gap-2', p.ok ? 'text-emerald-400' : 'text-gray-500')}>
              <span className={cn('inline-flex h-4 w-4 items-center justify-center rounded border', p.ok ? 'border-emerald-400 bg-emerald-400/10' : 'border-gray-600')}>
                {p.ok && <Check className="h-3 w-3" />}
              </span>
              {p.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Bias (1H direction)</span>
          <input
            type="text"
            value={values.bias}
            onChange={(e) => update('bias', e.target.value)}
            placeholder="bull / bear / neutral + reasoning"
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Setup</span>
          <select
            value={values.setup}
            onChange={(e) => update('setup', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          >
            <option value="">— choose —</option>
            {SETUPS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs text-gray-400">Trigger (5m signal)</span>
          <input
            type="text"
            value={values.trigger}
            onChange={(e) => update('trigger', e.target.value)}
            placeholder="break, retest, confirm…"
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-1 block text-xs text-gray-400">Location</span>
          <input
            type="text"
            value={values.location}
            onChange={(e) => update('location', e.target.value)}
            placeholder="approved location, room to target"
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Direction</span>
          <select
            value={values.direction}
            onChange={(e) => update('direction', e.target.value as ChecklistValues['direction'])}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          >
            <option value="">— choose —</option>
            <option value="long">long</option>
            <option value="short">short</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Confidence (1–5)</span>
          <input
            type="number" min="1" max="5"
            value={values.confidence}
            onChange={(e) => update('confidence', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Entry</span>
          <input
            type="number" step="0.25"
            value={values.entryPrice}
            onChange={(e) => update('entryPrice', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Stop</span>
          <input
            type="number" step="0.25"
            value={values.stopPrice}
            onChange={(e) => update('stopPrice', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-gray-400">Target</span>
          <input
            type="number" step="0.25"
            value={values.targetPrice}
            onChange={(e) => update('targetPrice', e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={!allValid || !!disabled}
        onClick={onStartPlayback}
        className={cn(
          'w-full rounded-lg py-3 text-sm font-medium transition',
          allValid
            ? 'bg-emerald-500 text-white hover:bg-emerald-400'
            : 'cursor-not-allowed bg-gray-800 text-gray-500'
        )}
      >
        {allValid ? 'Start Playback — Trade Is Live' : `Fill all 5 pillars + direction to continue`}
      </button>
    </div>
  )
}
