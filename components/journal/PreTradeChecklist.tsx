'use client'

import { useState } from 'react'
import { Trade } from '@/types'
import { cn, formatCurrency } from '@/lib/utils'
import { ClipboardCheck } from 'lucide-react'

export interface ChecklistAnswers {
  inPlan: boolean
  stop: string
  target: string
}

interface PreTradeChecklistProps {
  trade: Trade
  onComplete: (answers: ChecklistAnswers) => void
  onCancel: () => void
}

export default function PreTradeChecklist({ trade, onComplete, onCancel }: PreTradeChecklistProps) {
  const [inPlan, setInPlan] = useState<boolean | null>(null)
  const [stop, setStop] = useState(trade.stop_loss?.toString() || '')
  const [target, setTarget] = useState(trade.target?.toString() || '')

  const canProceed = inPlan !== null && stop !== '' && target !== ''

  function handleContinue() {
    if (!canProceed) return
    onComplete({ inPlan: inPlan!, stop, target })
  }

  return (
    <div className="space-y-6">
      {/* Trade summary */}
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

      {/* Gate notice */}
      <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5">
        <ClipboardCheck className="h-4 w-4 text-amber-400 shrink-0" />
        <span className="text-sm font-medium text-amber-300">Answer all 3 questions to unlock annotation</span>
      </div>

      {/* Q1: In plan? */}
      <div>
        <p className="text-sm font-medium text-gray-200 mb-3">
          1. Was this trade in your plan?
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setInPlan(true)}
            className={cn(
              'flex-1 py-2.5 rounded-lg border font-semibold text-sm transition',
              inPlan === true
                ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'
            )}
          >
            Yes
          </button>
          <button
            onClick={() => setInPlan(false)}
            className={cn(
              'flex-1 py-2.5 rounded-lg border font-semibold text-sm transition',
              inPlan === false
                ? 'border-red-500 bg-red-500/20 text-red-400'
                : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'
            )}
          >
            No
          </button>
        </div>
        {inPlan === false && (
          <p className="text-xs text-amber-400 mt-2 pl-1">
            This trade will be tagged as &ldquo;off-plan&rdquo;.
          </p>
        )}
      </div>

      {/* Q2: Stop */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-1.5">
          2. What was your stop loss? <span className="text-red-400">*</span>
        </label>
        <input
          type="number"
          step="0.25"
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          placeholder="Price level"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Q3: Target */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-1.5">
          3. What was your target? <span className="text-red-400">*</span>
        </label>
        <input
          type="number"
          step="0.25"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Price level"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Progress indicator */}
      <div className="flex gap-1.5">
        <div className={cn('h-1 flex-1 rounded-full', inPlan !== null ? 'bg-blue-500' : 'bg-gray-700')} />
        <div className={cn('h-1 flex-1 rounded-full', stop !== '' ? 'bg-blue-500' : 'bg-gray-700')} />
        <div className={cn('h-1 flex-1 rounded-full', target !== '' ? 'bg-blue-500' : 'bg-gray-700')} />
      </div>

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
