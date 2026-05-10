'use client'

import { useState } from 'react'
import { Trade } from '@/types'
import { cn, getMoodEmoji, formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

interface TradeAnnotationFormProps {
  trade: Trade
  onClose: () => void
  onSaved: (trade: Trade) => void
}

const MOODS = ['calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident'] as const
const GRADES = ['A', 'B', 'C'] as const

export default function TradeAnnotationForm({ trade, onClose, onSaved }: TradeAnnotationFormProps) {
  const [mood, setMood] = useState<Trade['mood']>(trade.mood)
  const [grade, setGrade] = useState<Trade['grade']>(trade.grade)
  const [setupTag, setSetupTag] = useState(trade.setup_tag || '')
  const [mae, setMae] = useState(trade.mae?.toString() || '')
  const [mfe, setMfe] = useState(trade.mfe?.toString() || '')
  const [stopLoss, setStopLoss] = useState(trade.stop_loss?.toString() || '')
  const [target, setTarget] = useState(trade.target?.toString() || '')
  const [notes, setNotes] = useState(trade.notes || '')
  const [reflection, setReflection] = useState(trade.reflection || '')
  const [tags, setTags] = useState((trade.tags || []).join(', '))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mood: mood || null,
          grade: grade || null,
          setup_tag: setupTag || null,
          mae: mae ? parseFloat(mae) : null,
          mfe: mfe ? parseFloat(mfe) : null,
          stop_loss: stopLoss ? parseFloat(stopLoss) : null,
          target: target ? parseFloat(target) : null,
          notes: notes || null,
          reflection: reflection || null,
          tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to save')
      }

      const updated = await res.json()
      toast.success('Trade annotated!')
      onSaved(updated)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const gradeColors: Record<string, string> = {
    A: 'border-emerald-500 bg-emerald-500/20 text-emerald-400',
    B: 'border-yellow-500 bg-yellow-500/20 text-yellow-400',
    C: 'border-red-500 bg-red-500/20 text-red-400',
  }

  return (
    <div className="space-y-5">
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

      {/* Mood selector */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Mood</label>
        <div className="grid grid-cols-4 gap-2">
          {MOODS.map((m) => (
            <button
              key={m}
              onClick={() => setMood(mood === m ? null : m)}
              className={cn(
                'flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border text-xs transition',
                mood === m
                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                  : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
              )}
            >
              <span className="text-lg">{getMoodEmoji(m)}</span>
              <span className="capitalize">{m}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Grade selector */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Grade</label>
        <div className="flex gap-3">
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => setGrade(grade === g ? null : g)}
              className={cn(
                'flex-1 py-2 rounded-lg border font-bold text-lg transition',
                grade === g
                  ? gradeColors[g]
                  : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Setup tag */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Setup Tag</label>
        <input
          type="text"
          value={setupTag}
          onChange={(e) => setSetupTag(e.target.value)}
          placeholder="e.g. Breakout, Fade, VWAP test..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* MAE / MFE / SL / Target in a grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">MAE (pts)</label>
          <input
            type="number"
            step="0.25"
            value={mae}
            onChange={(e) => setMae(e.target.value)}
            placeholder="0.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">MFE (pts)</label>
          <input
            type="number"
            step="0.25"
            value={mfe}
            onChange={(e) => setMfe(e.target.value)}
            placeholder="0.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Stop Loss</label>
          <input
            type="number"
            step="0.25"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="Price level"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Target</label>
          <input
            type="number"
            step="0.25"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Price level"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="What was the trade thesis? Market context?"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Post-trade reflection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Post-Trade Reflection</label>
        <textarea
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          rows={3}
          placeholder="What did you do well? What would you do differently?"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Tags</label>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="e.g. news-trade, overtraded, patience (comma separated)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-lg border border-gray-700 text-sm font-medium text-gray-400 hover:text-white hover:border-gray-600 transition"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold text-white transition"
        >
          {saving ? 'Saving...' : 'Save Annotation'}
        </button>
      </div>
    </div>
  )
}
