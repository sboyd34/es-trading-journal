'use client'

import { cn } from '@/lib/utils'
import { Play, Pause, SkipForward, X } from 'lucide-react'

export type PlaybackSpeed = 0.5 | 1 | 2 | 5

export const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 5]

interface Props {
  playing: boolean
  speed: PlaybackSpeed
  currentBar: number
  totalBars: number
  onTogglePlay: () => void
  onSpeedChange: (s: PlaybackSpeed) => void
  onStep: () => void
  onBail: () => void
}

export default function PlaybackControls({
  playing, speed, currentBar, totalBars,
  onTogglePlay, onSpeedChange, onStep, onBail,
}: Props) {
  const progressPct = totalBars > 0 ? Math.min(100, (currentBar / totalBars) * 100) : 0

  return (
    <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-900/50 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePlay}
          className="inline-flex items-center gap-1.5 rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-400"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {playing ? 'Pause' : 'Play'}
        </button>

        <button
          type="button"
          onClick={onStep}
          disabled={playing}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium',
            playing
              ? 'cursor-not-allowed bg-gray-800 text-gray-500'
              : 'bg-gray-700 text-gray-100 hover:bg-gray-600'
          )}
        >
          <SkipForward className="h-4 w-4" />
          Step
        </button>

        <div className="ml-2 flex items-center gap-1">
          <span className="text-xs text-gray-400">Speed</span>
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              className={cn(
                'rounded px-2 py-1 text-xs font-medium',
                speed === s
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              )}
            >
              {s}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onBail}
          className="ml-auto inline-flex items-center gap-1.5 rounded bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20"
        >
          <X className="h-4 w-4" />
          Bail
        </button>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>Bar {currentBar} of {totalBars}</span>
          <span>{progressPct.toFixed(0)}% through session</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-800">
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>
    </div>
  )
}
