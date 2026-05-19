'use client'

import { cn } from '@/lib/utils'

export const MISTAKE_TYPES = [
  'Outside time window',
  'Broke checklist (claimed pillars I didn\'t actually verify)',
  'No setup confluence',
  'Chased entry (price ran before I clicked)',
  'Held loser past mental stop',
  'Cut winner too early',
  'FOMO — wasn\'t really my setup',
  'Clean — no mistake, just a loss',
  'Other',
] as const

export type MistakeType = typeof MISTAKE_TYPES[number]

interface Props {
  value: MistakeType | ''
  otherText: string
  onValueChange: (v: MistakeType | '') => void
  onOtherChange: (t: string) => void
}

export default function MistakeSelector({ value, otherText, onValueChange, onOtherChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-400">What broke down? (Be honest — &quot;Clean&quot; is a valid answer.)</div>
      <div className="space-y-1">
        {MISTAKE_TYPES.map((m) => (
          <label
            key={m}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded border p-2 text-sm transition',
              value === m
                ? 'border-blue-500 bg-blue-500/10 text-gray-100'
                : 'border-gray-700 bg-gray-900/50 text-gray-400 hover:border-gray-600'
            )}
          >
            <input
              type="radio"
              name="mistake-type"
              checked={value === m}
              onChange={() => onValueChange(m)}
              className="mt-0.5"
            />
            <span>{m}</span>
          </label>
        ))}
      </div>
      {value === 'Other' && (
        <textarea
          value={otherText}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Describe the mistake…"
          rows={2}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
        />
      )}
    </div>
  )
}
