'use client'

import { useState, useRef, useEffect } from 'react'
import { Trade, ApexAccount } from '@/types'
import { cn, getMoodEmoji, formatCurrency } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import { Mic, Square, Camera, ChevronDown, ChevronUp, Newspaper, ExternalLink } from 'lucide-react'
import { SYSTEM_SETUPS } from '@/lib/trading-system'
import type { GateAnswers } from '@/components/journal/FiveWordGateModal'
import ImageUploadSlot from '@/components/ui/ImageUploadSlot'

interface TradeAnnotationFormProps {
  trade: Trade
  onClose: () => void
  onSaved: (trade: Trade) => void
  initialStopLoss?: string
  initialTarget?: string
  initialInPlan?: boolean
  isRevengeTrade?: boolean
  gateAnswers?: GateAnswers
}

const MOODS = ['calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident'] as const
const GRADES = ['A', 'B', 'C'] as const
const BUCKET = 'trade-charts'

// ─── Main form ────────────────────────────────────────────────────────────────

export default function TradeAnnotationForm({
  trade,
  onClose,
  onSaved,
  initialStopLoss,
  initialTarget,
  initialInPlan,
  isRevengeTrade,
  gateAnswers,
}: TradeAnnotationFormProps) {
  const [mood, setMood] = useState<Trade['mood']>(trade.mood)
  const [grade, setGrade] = useState<Trade['grade']>(trade.grade)
  const [offSystem, setOffSystem] = useState<boolean>(trade.grade === 'F')
  const [showRubric, setShowRubric] = useState(false)
  const [setupTag, setSetupTag] = useState(gateAnswers?.setup || trade.setup_tag || '')
  const [mae, setMae] = useState(trade.mae?.toString() || '')
  const [mfe, setMfe] = useState(trade.mfe?.toString() || '')
  const [stopLoss, setStopLoss] = useState(initialStopLoss ?? trade.stop_loss?.toString() ?? '')
  const [target, setTarget] = useState(initialTarget ?? trade.target?.toString() ?? '')
  const [notes, setNotes] = useState(trade.notes || '')
  const [reflection, setReflection] = useState(trade.reflection || '')
  const [tags, setTags] = useState(() => {
    const existing = (trade.tags || []).filter((t) => t !== 'off-plan')
    if (initialInPlan === false) return ['off-plan', ...existing].join(', ')
    return existing.join(', ')
  })
  const [instrument, setInstrument] = useState(trade.instrument || 'ES')
  const [accountId, setAccountId] = useState<string | null>(trade.account_id ?? null)
  const [accounts, setAccounts] = useState<ApexAccount[]>([])
  const [saving, setSaving] = useState(false)
  const [isRecording, setIsRecording] = useState(false)

  // Chart upload state — initialise from existing trade URLs
  const [entryChart, setEntryChart] = useState<string | null>(trade.entry_chart_url ?? null)
  const [exitChart, setExitChart] = useState<string | null>(trade.exit_chart_url ?? null)
  const [uploadingEntry, setUploadingEntry] = useState(false)
  const [uploadingExit, setUploadingExit] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const supabase = createClient()

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  // Load the user's Apex accounts so the form can show an account dropdown
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('apex_accounts')
        .select('*')
        .order('created_at', { ascending: true, nullsFirst: false })
      if (!cancelled && data) setAccounts(data as ApexAccount[])
    })()
    return () => { cancelled = true }
  }, [supabase])

  // ── Voice recording ──────────────────────────────────────────────────────

  function toggleRecording() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    const SpeechRecognitionAPI = win.SpeechRecognition || win.webkitSpeechRecognition

    if (!SpeechRecognitionAPI) {
      toast.error('Voice input is not supported in this browser')
      return
    }

    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SpeechRecognitionAPI() as any
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onresult = (event: { results: ArrayLike<SpeechRecognitionResult>; resultIndex: number }) => {
      const transcript = Array.from(event.results as ArrayLike<SpeechRecognitionResult>)
        .slice(event.resultIndex)
        .map((r) => r[0].transcript)
        .join(' ')
      setNotes((prev) => (prev ? prev + ' ' + transcript : transcript))
    }

    recognition.onerror = () => {
      toast.error('Voice recognition error — please try again')
      setIsRecording(false)
    }

    recognition.onend = () => setIsRecording(false)

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
    toast.success('Listening… speak your notes', { duration: 2000 })
  }

  // ── Chart upload/remove ──────────────────────────────────────────────────

  async function handleImageUpload(file: File, type: 'entry' | 'exit') {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image must be under 10 MB')
      return
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${trade.user_id}/${trade.id}/${type}.${ext}`

    if (type === 'entry') setUploadingEntry(true); else setUploadingExit(true)

    try {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type })

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      // Append cache-buster so browsers reload replaced images
      const url = `${data.publicUrl}?t=${Date.now()}`

      if (type === 'entry') setEntryChart(url); else setExitChart(url)
      toast.success(`${type === 'entry' ? 'Entry' : 'Exit'} chart uploaded`)
    } catch (err) {
      toast.error('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      if (type === 'entry') setUploadingEntry(false); else setUploadingExit(false)
    }
  }

  async function handleImageRemove(type: 'entry' | 'exit') {
    const url = type === 'entry' ? entryChart : exitChart
    if (!url) return

    // Extract the storage path from the public URL
    const storagePath = url.split(`/${BUCKET}/`)[1]?.split('?')[0]
    if (storagePath) {
      await supabase.storage.from(BUCKET).remove([storagePath])
    }

    if (type === 'entry') setEntryChart(null); else setExitChart(null)
    toast.success('Chart removed')
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mood: offSystem ? null : (mood || null),
          grade: offSystem ? 'F' : (grade || null),
          setup_tag: offSystem ? null : (setupTag || null),
          mae: offSystem ? null : (mae ? parseFloat(mae) : null),
          mfe: offSystem ? null : (mfe ? parseFloat(mfe) : null),
          stop_loss: offSystem ? null : (stopLoss ? parseFloat(stopLoss) : null),
          target: offSystem ? null : (target ? parseFloat(target) : null),
          notes: notes || null,
          reflection: reflection || null,
          tags: offSystem ? [] : (tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : []),
          instrument,
          account_id: accountId,
          entry_chart_url: offSystem ? null : (entryChart ? entryChart.split('?')[0] : null),
          exit_chart_url: offSystem ? null : (exitChart ? exitChart.split('?')[0] : null),
          ...(gateAnswers && !offSystem && {
            trade_bias: gateAnswers.bias,
            trade_setup: gateAnswers.setup,
            trade_trigger: gateAnswers.trigger,
            trade_location: gateAnswers.location,
            trade_risk: gateAnswers.risk,
          }),
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

  // ── Render ────────────────────────────────────────────────────────────────

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

      {/* Revenge trade warning */}
      {isRevengeTrade && (
        <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2.5">
          <span className="text-amber-400 text-base mt-0.5">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-300">Potential Revenge Trade</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              This trade was entered within 3 minutes of a losing trade. Review carefully.
            </p>
          </div>
        </div>
      )}

      {/* Mood selector — hidden when off-system */}
      {!offSystem && (
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
      )}

      {/* Grade selector + rubric — hidden when off-system */}
      {!offSystem && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-300">Grade</label>
            <button
              type="button"
              onClick={() => setShowRubric(!showRubric)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition"
            >
              Grade Guide
              {showRubric ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
          <div className="flex gap-3 mb-2">
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
          {showRubric && (
            <div className="mt-2 rounded-lg border border-gray-700/60 bg-gray-900/50 divide-y divide-gray-700/40 text-xs">
              <div className="p-3">
                <p className="font-semibold text-emerald-400 mb-1">A — All criteria met</p>
                <p className="text-gray-400 leading-relaxed">1H bias clear and aligned · Correct setup from priority list · Approved location with room · Break→Retest→Confirm→Enter followed · Inside approved time window · Emotionally flat</p>
              </div>
              <div className="p-3">
                <p className="font-semibold text-yellow-400 mb-1">B — One minor deviation</p>
                <p className="text-gray-400 leading-relaxed">Slightly early entry · Tier 2 location without extra confirmation candle · Small size adjustment · Otherwise rule-following</p>
              </div>
              <div className="p-3">
                <p className="font-semibold text-red-400 mb-1">C — Rule violation</p>
                <p className="text-gray-400 leading-relaxed">POC/mid-value/chop entry · Wrong time window · Wrong direction vs bias · Chased extended candle · Entered on bubble/fire alone · FOMO or revenge state · Blind-touch trade</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Off-system toggle — F flag */}
      <div className="rounded-lg border border-gray-700/60 bg-gray-900/40 p-3">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={offSystem}
            onChange={(e) => {
              const next = e.target.checked
              setOffSystem(next)
              if (!next && grade === 'F') setGrade(null)
            }}
            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-white focus:ring-1 focus:ring-gray-400"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-200">Off-system trade (F)</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Use when the trade wasn&apos;t one of the 5 setups — a discipline lapse, not a graded execution.
            </p>
          </div>
        </label>
      </div>

      {/* Instrument (always) + Setup tag (hidden when off-system) */}
      <div className={cn('grid gap-3', offSystem ? 'grid-cols-1' : 'grid-cols-3')}>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Instrument</label>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ES">ES ($50/pt)</option>
            <option value="NQ">NQ ($20/pt)</option>
            <option value="MES">MES ($5/pt)</option>
            <option value="MNQ">MNQ ($2/pt)</option>
          </select>
        </div>
        {!offSystem && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-400 mb-1">Setup Tag</label>
            <select
              value={setupTag}
              onChange={(e) => setSetupTag(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select setup...</option>
              {SYSTEM_SETUPS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Apex account */}
      {accounts.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Apex Account</label>
          <select
            value={accountId ?? ''}
            onChange={(e) => setAccountId(e.target.value || null)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Unassigned</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.mode === 'pa' ? 'PA' : 'Eval'} ${(a.account_size / 1000).toFixed(0)}K
              </option>
            ))}
          </select>
        </div>
      )}

      {/* MAE / MFE / SL / Target — hidden when off-system */}
      {!offSystem && (
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
      )}

      {/* Notes with voice input */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-gray-300">
            {offSystem ? 'What made you enter this trade?' : 'Notes'}
          </label>
          <button
            type="button"
            onClick={toggleRecording}
            title={isRecording ? 'Stop recording' : 'Record voice note'}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition',
              isRecording
                ? 'bg-red-500/20 border border-red-500/50 text-red-400 animate-pulse'
                : 'bg-gray-700/50 border border-gray-600/50 text-gray-400 hover:text-white hover:border-gray-500'
            )}
          >
            {isRecording ? (
              <>
                <Square className="h-3 w-3 fill-current" />
                Stop
              </>
            ) : (
              <>
                <Mic className="h-3 w-3" />
                Voice
              </>
            )}
          </button>
        </div>
        {isRecording && (
          <div className="flex items-center gap-2 mb-1.5 text-xs text-red-400">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            Listening — speak now
          </div>
        )}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={offSystem ? 3 : 2}
          placeholder={
            offSystem
              ? "Boredom, FOMO, news pop, pattern that looked good but wasn't on the list…"
              : 'What was the trade thesis? Market context?'
          }
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Post-trade reflection */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">
          {offSystem ? 'Post-trade notes — what did you learn?' : 'Post-Trade Reflection'}
        </label>
        <textarea
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          rows={3}
          placeholder={
            offSystem
              ? 'What was the cost? What would have stopped you?'
              : 'What did you do well? What would you do differently?'
          }
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* News near entry — silent when none */}
      {trade.news_articles && trade.news_articles.length > 0 && (
        <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Newspaper className="h-4 w-4 text-amber-400" />
            <p className="text-sm font-semibold text-amber-300">
              News near entry ({trade.news_articles.length})
            </p>
            <span className="text-[10px] uppercase tracking-wider text-amber-400/70">within 15 min</span>
          </div>
          <ul className="space-y-1.5">
            {trade.news_articles.map((a, i) => (
              <li key={i} className="text-xs">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-2 hover:text-white transition"
                >
                  <span className="text-amber-400 mt-0.5">▸</span>
                  <span className="flex-1 text-gray-200 group-hover:text-white leading-snug">
                    {a.title}
                    <span className="block text-[11px] text-gray-500 mt-0.5">
                      {a.source} · {new Date(a.publishedAt).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </span>
                  <ExternalLink className="h-3 w-3 text-gray-600 group-hover:text-gray-300 mt-0.5 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tags — hidden when off-system */}
      {!offSystem && (
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
      )}

      {/* Chart screenshots — hidden when off-system */}
      {!offSystem && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Camera className="h-4 w-4 text-gray-400" />
            <label className="text-sm font-medium text-gray-300">Chart Screenshots</label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ImageUploadSlot
              label="Entry Chart"
              currentUrl={entryChart}
              uploading={uploadingEntry}
              onFile={(file) => handleImageUpload(file, 'entry')}
              onClear={() => handleImageRemove('entry')}
            />
            <ImageUploadSlot
              label="Exit Chart"
              currentUrl={exitChart}
              uploading={uploadingExit}
              onFile={(file) => handleImageUpload(file, 'exit')}
              onClear={() => handleImageRemove('exit')}
            />
          </div>
        </div>
      )}

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
          disabled={saving || uploadingEntry || uploadingExit}
          className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold text-white transition"
        >
          {saving ? 'Saving…' : uploadingEntry || uploadingExit ? 'Uploading…' : 'Save Annotation'}
        </button>
      </div>
    </div>
  )
}
