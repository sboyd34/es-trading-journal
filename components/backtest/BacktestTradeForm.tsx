'use client'

import { useState, useMemo } from 'react'
import { BacktestTrade } from '@/types'
import { cn, getMoodEmoji } from '@/lib/utils'
import { GateAnswers } from '@/components/journal/FiveWordGateModal'
import { SYSTEM_SETUPS } from '@/lib/trading-system'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronUp } from 'lucide-react'

const MOODS = ['calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident'] as const
const GRADES = ['A', 'B', 'C'] as const
const POINT_VALUES: Record<string, number> = { ES: 50, MES: 5, NQ: 20, MNQ: 2 }
const COMMISSION_PER_CONTRACT = 4.10

interface Props {
  date: string
  sessionId: string | null
  gateAnswers: GateAnswers
  editingTrade?: BacktestTrade
  onSaved: (trade: BacktestTrade) => void
  onClose: () => void
}

export default function BacktestTradeForm({ date, sessionId, gateAnswers, editingTrade, onSaved, onClose }: Props) {
  const isEdit = !!editingTrade

  const [direction, setDirection] = useState<'long' | 'short'>(editingTrade?.direction ?? 'long')
  const [instrument, setInstrument] = useState(editingTrade?.instrument ?? 'ES')
  const [entryPrice, setEntryPrice] = useState(editingTrade?.entry_price.toString() ?? '')
  const [exitPrice, setExitPrice] = useState(editingTrade?.exit_price.toString() ?? '')
  const [quantity, setQuantity] = useState(editingTrade?.quantity.toString() ?? '1')
  const [entryTime, setEntryTime] = useState(editingTrade?.entry_time ?? '')
  const [exitTime, setExitTime] = useState(editingTrade?.exit_time ?? '')
  const [stopLoss, setStopLoss] = useState(editingTrade?.stop_loss?.toString() ?? '')
  const [target, setTarget] = useState(editingTrade?.target?.toString() ?? '')
  const [mae, setMae] = useState(editingTrade?.mae?.toString() ?? '')
  const [mfe, setMfe] = useState(editingTrade?.mfe?.toString() ?? '')
  const [mood, setMood] = useState<string | null>(editingTrade?.mood ?? null)
  const [grade, setGrade] = useState<'A' | 'B' | 'C' | null>(editingTrade?.grade ?? null)
  const [showRubric, setShowRubric] = useState(false)
  const [setupTag, setSetupTag] = useState(editingTrade?.setup_tag ?? gateAnswers.setup)
  const [notes, setNotes] = useState(editingTrade?.notes ?? '')
  const [reflection, setReflection] = useState(editingTrade?.reflection ?? '')
  const [tags, setTags] = useState(editingTrade?.tags?.join(', ') ?? '')
  const [saving, setSaving] = useState(false)

  const pnl = useMemo(() => {
    const entry = parseFloat(entryPrice)
    const exit = parseFloat(exitPrice)
    const qty = parseInt(quantity) || 1
    if (isNaN(entry) || isNaN(exit)) return null
    const pv = POINT_VALUES[instrument] ?? 50
    const gross = (direction === 'long' ? exit - entry : entry - exit) * pv * qty
    const commission = qty * COMMISSION_PER_CONTRACT
    return {
      gross: Math.round(gross * 100) / 100,
      commission: Math.round(commission * 100) / 100,
      net: Math.round((gross - commission) * 100) / 100,
    }
  }, [entryPrice, exitPrice, quantity, direction, instrument])

  const gradeColors: Record<string, string> = {
    A: 'border-emerald-500 bg-emerald-500/20 text-emerald-400',
    B: 'border-yellow-500 bg-yellow-500/20 text-yellow-400',
    C: 'border-red-500 bg-red-500/20 text-red-400',
  }

  async function handleSave() {
    if (!entryPrice || !exitPrice) {
      toast.error('Entry and exit price are required')
      return
    }
    if (!pnl) { toast.error('Invalid price values'); return }

    setSaving(true)
    try {
      const payload = {
        date,
        session_id: sessionId,
        direction,
        instrument,
        entry_price: parseFloat(entryPrice),
        exit_price: parseFloat(exitPrice),
        quantity: parseInt(quantity) || 1,
        entry_time: entryTime || null,
        exit_time: exitTime || null,
        gross_pnl: pnl.gross,
        commission: pnl.commission,
        net_pnl: pnl.net,
        stop_loss: stopLoss ? parseFloat(stopLoss) : null,
        target: target ? parseFloat(target) : null,
        mae: mae ? parseFloat(mae) : null,
        mfe: mfe ? parseFloat(mfe) : null,
        mood: mood || null,
        grade: grade || null,
        setup_tag: setupTag || null,
        notes: notes || null,
        reflection: reflection || null,
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        trade_bias: gateAnswers.bias,
        trade_setup: gateAnswers.setup,
        trade_trigger: gateAnswers.trigger,
        trade_location: gateAnswers.location,
        trade_risk: gateAnswers.risk,
      }

      const url = isEdit ? `/api/backtest/trades/${editingTrade!.id}` : '/api/backtest/trades'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')

      toast.success(isEdit ? 'Trade updated' : 'Trade logged')
      onSaved(data.trade)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Gate summary */}
      <div className="bg-gray-800/60 rounded-lg p-3 grid grid-cols-5 gap-1 text-xs">
        {[
          { label: 'Bias', value: gateAnswers.bias },
          { label: 'Setup', value: gateAnswers.setup },
          { label: 'Trigger', value: gateAnswers.trigger },
          { label: 'Location', value: gateAnswers.location },
          { label: 'Risk', value: gateAnswers.risk },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <p className="text-gray-500">{label}</p>
            <p className="text-gray-300 font-medium truncate" title={value}>{value || '—'}</p>
          </div>
        ))}
      </div>

      {/* Entry fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Direction</label>
          <div className="flex gap-2">
            {(['long', 'short'] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={cn(
                  'flex-1 py-2 rounded-lg border text-sm font-semibold transition',
                  direction === d
                    ? d === 'long' ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' : 'border-red-500 bg-red-500/20 text-red-400'
                    : 'border-gray-700 text-gray-400 hover:border-gray-600'
                )}
              >
                {d === 'long' ? 'Long' : 'Short'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Instrument</label>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ES">ES ($50/pt)</option>
            <option value="MES">MES ($5/pt)</option>
            <option value="NQ">NQ ($20/pt)</option>
            <option value="MNQ">MNQ ($2/pt)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Entry Price</label>
          <input type="number" step="0.25" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)}
            placeholder="5800.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Exit Price</label>
          <input type="number" step="0.25" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)}
            placeholder="5820.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Qty</label>
          <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Entry Time (CT)</label>
          <input type="text" value={entryTime} onChange={(e) => setEntryTime(e.target.value)}
            placeholder="09:05"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Exit Time (CT)</label>
          <input type="text" value={exitTime} onChange={(e) => setExitTime(e.target.value)}
            placeholder="09:22"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Live P&L preview */}
      {pnl && (
        <div className="bg-gray-800/60 rounded-lg p-3 flex items-center justify-between text-sm">
          <span className="text-gray-400 text-xs">Calculated P&L</span>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-500">Gross: <span className={pnl.gross >= 0 ? 'text-emerald-400' : 'text-red-400'}>${pnl.gross.toFixed(2)}</span></span>
            <span className="text-gray-500">Comm: <span className="text-gray-400">(${pnl.commission.toFixed(2)})</span></span>
            <span className={`font-bold text-sm ${pnl.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>Net: ${pnl.net.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Stop / Target / MAE / MFE */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Stop Loss</label>
          <input type="number" step="0.25" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="Price"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Target</label>
          <input type="number" step="0.25" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Price"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">MAE (pts)</label>
          <input type="number" step="0.25" value={mae} onChange={(e) => setMae(e.target.value)} placeholder="0.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">MFE (pts)</label>
          <input type="number" step="0.25" value={mfe} onChange={(e) => setMfe(e.target.value)} placeholder="0.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Mood */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Mood</label>
        <div className="grid grid-cols-4 gap-2">
          {MOODS.map((m) => (
            <button key={m} onClick={() => setMood(mood === m ? null : m)}
              className={cn(
                'flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border text-xs transition',
                mood === m ? 'border-blue-500 bg-blue-500/20 text-blue-300' : 'border-gray-700 text-gray-400 hover:border-gray-600'
              )}
            >
              <span className="text-lg">{getMoodEmoji(m)}</span>
              <span className="capitalize">{m}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Grade */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-300">Grade</label>
          <button type="button" onClick={() => setShowRubric(!showRubric)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition">
            Grade Guide {showRubric ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
        <div className="flex gap-3 mb-2">
          {GRADES.map((g) => (
            <button key={g} onClick={() => setGrade(grade === g ? null : g)}
              className={cn(
                'flex-1 py-2 rounded-lg border font-bold text-lg transition',
                grade === g ? gradeColors[g] : 'border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-300'
              )}
            >{g}</button>
          ))}
        </div>
        {showRubric && (
          <div className="mt-2 rounded-lg border border-gray-700/60 bg-gray-900/50 divide-y divide-gray-700/40 text-xs">
            <div className="p-3"><p className="font-semibold text-emerald-400 mb-1">A — All criteria met</p><p className="text-gray-400 leading-relaxed">1H bias aligned · Correct setup · Approved location with room · Break→Retest→Confirm→Enter · Approved time window · Emotionally flat</p></div>
            <div className="p-3"><p className="font-semibold text-yellow-400 mb-1">B — One minor deviation</p><p className="text-gray-400 leading-relaxed">Slightly early entry · Tier 2 location without extra confirm · Small size adjustment</p></div>
            <div className="p-3"><p className="font-semibold text-red-400 mb-1">C — Rule violation</p><p className="text-gray-400 leading-relaxed">POC/mid-value/chop entry · Wrong time window · Wrong direction vs bias · Chased candle · Entered on fire alone · FOMO/revenge · Blind-touch</p></div>
          </div>
        )}
      </div>

      {/* Setup tag */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Setup Tag</label>
        <select value={setupTag} onChange={(e) => setSetupTag(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Select setup...</option>
          {SYSTEM_SETUPS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          placeholder="Trade thesis, context..."
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>

      {/* Reflection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Reflection</label>
        <textarea value={reflection} onChange={(e) => setReflection(e.target.value)} rows={2}
          placeholder="What would you do differently?"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
      </div>

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">Tags</label>
        <input type="text" value={tags} onChange={(e) => setTags(e.target.value)}
          placeholder="comma separated tags"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button onClick={onClose}
          className="flex-1 py-2.5 rounded-lg border border-gray-700 text-sm font-medium text-gray-400 hover:text-white hover:border-gray-600 transition">
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold text-white transition">
          {saving ? 'Saving…' : isEdit ? 'Update Trade' : 'Log Trade'}
        </button>
      </div>
    </div>
  )
}
