'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase/client'
import type { PreOpenCheck } from '@/types'
import {
  THE_15_RULES,
  PRE_OPEN_CHECK_ITEMS,
  getTodayChicagoDateString,
} from '@/lib/preopen-ritual'
import { cn } from '@/lib/utils'

const EMPTY_CHECK: PreOpenCheck = {
  rules_read: false,
  bracket_loaded: false,
  targets_written: false,
  not_revenge_trading: false,
}

/**
 * Pre-Session Ritual section for the /pre-market page.
 *
 * - Renders the 15 anti-greed rules in a numbered list
 * - Provides a "I have read these aloud" button (auto-ticks box #1)
 * - Renders the 4-item Pre-Open Check with per-checkbox auto-save
 * - Auto-completes (checklist_passed = true) the moment all 4 boxes
 *   are ticked; no explicit Save button required
 *
 * Spec: docs/superpowers/specs/2026-05-26-preopen-ritual-design.md
 */
export default function PreSessionRitual() {
  const supabase = createClient()
  const todayStr = useMemo(() => getTodayChicagoDateString(), [])
  const [check, setCheck] = useState<PreOpenCheck>(EMPTY_CHECK)
  const [checklistPassed, setChecklistPassed] = useState<boolean>(false)
  const [loading, setLoading] = useState(true)
  // Tracks whether the auto-complete effect has already fired this session
  // so we don't re-save on every render after it's already complete.
  const hasAutoSaved = useRef(false)

  // Load today's existing check state (if any)
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('daily_sessions')
        .select('pre_open_check, checklist_passed')
        .eq('user_id', user.id)
        .eq('date', todayStr)
        .maybeSingle()
      if (data?.pre_open_check) setCheck(data.pre_open_check as PreOpenCheck)
      if (data?.checklist_passed === true) setChecklistPassed(true)
      setLoading(false)
    }
    load()
  }, [supabase, todayStr])

  // Per-checkbox auto-save: upserts the pre_open_check JSONB on every toggle.
  // Does NOT set checklist_passed — that only flips in the auto-complete effect.
  const persistCheck = useCallback(
    async (next: PreOpenCheck) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('daily_sessions')
        .upsert(
          {
            user_id: user.id,
            date: todayStr,
            pre_open_check: next,
          },
          { onConflict: 'user_id,date' },
        )
    },
    [supabase, todayStr],
  )

  const toggleCheck = useCallback(
    (key: keyof Omit<PreOpenCheck, 'saved_at'>) => {
      setCheck((prev) => {
        const next = { ...prev, [key]: !prev[key] }
        // Fire-and-forget auto-save; UI updates optimistically
        persistCheck(next)
        return next
      })
    },
    [persistCheck],
  )

  const markRulesRead = useCallback(() => {
    // Sets rules_read = true and auto-ticks box #1 (which IS rules_read).
    setCheck((prev) => {
      const next = { ...prev, rules_read: true }
      persistCheck(next)
      return next
    })
  }, [persistCheck])

  const checkedCount =
    Number(check.rules_read) +
    Number(check.bracket_loaded) +
    Number(check.targets_written) +
    Number(check.not_revenge_trading)
  const allChecked = checkedCount === 4

  // Auto-complete: the moment all 4 boxes are ticked, persist checklist_passed.
  // Guard with hasAutoSaved ref so this fires at most once per session
  // (covers the case where the page re-renders after the save succeeds).
  useEffect(() => {
    if (!allChecked || checklistPassed || hasAutoSaved.current) return
    hasAutoSaved.current = true
    const run = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const savedAt = new Date().toISOString()
        const finalCheck: PreOpenCheck = { ...check, saved_at: savedAt }
        const { error } = await supabase
          .from('daily_sessions')
          .upsert(
            {
              user_id: user.id,
              date: todayStr,
              pre_open_check: finalCheck,
              checklist_passed: true,
            },
            { onConflict: 'user_id,date' },
          )
        if (error) throw error
        setCheck(finalCheck)
        setChecklistPassed(true)
        toast.success('Ritual complete — have a disciplined session')
      } catch (err) {
        // Reset guard so a transient error doesn't permanently block re-try
        hasAutoSaved.current = false
        toast.error(err instanceof Error ? err.message : 'Failed to save ritual')
      }
    }
    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allChecked])

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-700/50 bg-gray-800/30 p-6 text-sm text-gray-500">
        Loading ritual…
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-gray-700/50 bg-gray-800/30 p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
          Pre-Session Ritual
          {checklistPassed && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Complete
            </span>
          )}
        </h2>
        <p className="text-sm italic text-gray-400 mt-1">
          Read aloud. Every session. Repetition is the antidote to impulse.
        </p>
      </div>

      {/* 15 rules */}
      <ol className="list-decimal list-outside pl-6 space-y-3 text-[15px] leading-relaxed text-gray-200">
        {THE_15_RULES.map((rule, i) => (
          <li key={i}>{rule}</li>
        ))}
      </ol>

      <div>
        <button
          type="button"
          onClick={markRulesRead}
          disabled={check.rules_read}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
            check.rules_read
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default'
              : 'bg-amber-500/15 text-amber-200 border border-amber-500/40 hover:bg-amber-500/25',
          )}
        >
          <CheckCircle2 className="h-4 w-4" />
          {check.rules_read ? 'Rules read aloud' : 'I have read these aloud'}
        </button>
      </div>

      {/* Pre-Open Check */}
      <div className="pt-4 border-t border-gray-700/50">
        <h3 className="text-sm font-semibold text-gray-200 mb-3">Pre-Open Check</h3>
        <div className="space-y-2">
          {PRE_OPEN_CHECK_ITEMS.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-start gap-3 cursor-pointer text-sm text-gray-200 hover:text-white"
            >
              <input
                type="checkbox"
                checked={check[key]}
                onChange={() => toggleCheck(key)}
                className="mt-1 h-4 w-4 rounded border-gray-600 bg-gray-800 accent-emerald-500 cursor-pointer"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

    </section>
  )
}
