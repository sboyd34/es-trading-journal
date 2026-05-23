'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { Trade, ApexAccount } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency } from '@/lib/utils'
import { differenceInDays, parseISO, format, addDays } from 'date-fns'
import {
  Settings2,
  ChevronDown,
  ChevronUp,
  Target,
  Shield,
  ShieldCheck,
  Trophy,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  Unlock,
  Info,
  TrendingUp,
  DollarSign,
  BarChart2,
  Plus,
  Trash2,
} from 'lucide-react'
import { APEX_CONFIGS, ACCOUNT_SIZES, type AccountSize } from '@/lib/apex-config'

const ACTIVE_ACCOUNT_KEY = 'apex.activeAccountId'

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: 'green' | 'amber' | 'red' }) {
  const pct = Math.min(100, Math.max(0, max > 0 ? (value / max) * 100 : 0))
  return (
    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500',
          color === 'green' && 'bg-emerald-500',
          color === 'amber' && 'bg-amber-500',
          color === 'red'   && 'bg-red-500',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function StatPill({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-800/60 rounded-xl p-3.5 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-base font-bold text-white">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('border border-gray-700/50 rounded-xl p-4 space-y-3', className)}>
      {children}
    </div>
  )
}

// ── Migration guide (shown when table hasn't been created yet) ────────────────

const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS apex_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  account_size integer NOT NULL DEFAULT 50000,
  mode text NOT NULL DEFAULT 'evaluation'
    CHECK (mode IN ('evaluation', 'pa')),
  drawdown_type text NOT NULL DEFAULT 'intraday'
    CHECK (drawdown_type IN ('eod', 'intraday')),
  starting_balance numeric NOT NULL DEFAULT 50000,
  current_balance numeric NOT NULL DEFAULT 50000,
  todays_starting_balance numeric NOT NULL DEFAULT 50000,
  highest_balance numeric NOT NULL DEFAULT 50000,
  purchase_date date,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, name)
);
ALTER TABLE apex_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own apex accounts" ON apex_accounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);`

function MigrationGuide() {
  const [copied, setCopied] = useState(false)

  function copySQL() {
    navigator.clipboard.writeText(MIGRATION_SQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="border border-amber-500/40 bg-amber-500/5 rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-300">One-time setup required</p>
          <p className="text-xs text-amber-400/80 mt-1">
            The Apex Tracker needs a database table. Copy the SQL below and run it once in your
            Supabase SQL editor, then refresh this page.
          </p>
        </div>
      </div>
      <pre className="text-[11px] bg-gray-900 border border-gray-700 rounded-lg p-3 overflow-x-auto text-gray-300 leading-relaxed">
        {MIGRATION_SQL}
      </pre>
      <div className="flex gap-3">
        <button
          onClick={copySQL}
          className="flex-1 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-sm font-medium text-amber-300 hover:bg-amber-500/30 transition"
        >
          {copied ? 'Copied ✓' : 'Copy SQL'}
        </button>
        <a
          href="https://supabase.com/dashboard/project/jpyoqukhpvaojpzdwjra/editor"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm font-medium text-gray-300 hover:text-white hover:border-gray-600 transition text-center"
        >
          Open SQL Editor →
        </a>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface ApexClientProps {
  userId: string
  initialAccounts: ApexAccount[]
  initialTrades: Trade[]
  tableReady: boolean
}

interface FormState {
  name: string
  broker_account_id: string
  account_size: number
  mode: 'evaluation' | 'pa'
  drawdown_type: 'eod' | 'intraday'
  starting_balance: string
  current_balance: string
  todays_starting_balance: string
  highest_balance: string
  purchase_date: string
}

function defaultForm(existingNames: string[]): FormState {
  let candidate = 'Account 1'
  let i = 1
  while (existingNames.includes(candidate)) {
    i++
    candidate = `Account ${i}`
  }
  return {
    name: candidate,
    broker_account_id: '',
    account_size: 50000,
    mode: 'evaluation',
    drawdown_type: 'intraday',
    starting_balance: '50000',
    current_balance: '50000',
    todays_starting_balance: '50000',
    highest_balance: '50000',
    purchase_date: '',
  }
}

function fromAccount(a: ApexAccount): FormState {
  return {
    name: a.name,
    broker_account_id: a.broker_account_id ?? '',
    account_size: a.account_size,
    mode: a.mode,
    drawdown_type: a.drawdown_type,
    starting_balance: String(a.starting_balance),
    current_balance: String(a.current_balance),
    todays_starting_balance: String(a.todays_starting_balance),
    highest_balance: String(a.highest_balance),
    purchase_date: a.purchase_date ?? '',
  }
}

type ActiveId = string | 'new' | null

export default function ApexClient({ userId, initialAccounts, initialTrades, tableReady }: ApexClientProps) {
  const supabase = createClient()

  const [accounts, setAccounts] = useState<ApexAccount[]>(initialAccounts)
  const [activeId, setActiveId] = useState<ActiveId>(() => {
    if (initialAccounts.length === 0) return tableReady ? 'new' : null
    return initialAccounts[0].id
  })

  // Restore last-viewed account from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined' || accounts.length === 0) return
    const stored = window.localStorage.getItem(ACTIVE_ACCOUNT_KEY)
    if (stored && accounts.some((a) => a.id === stored)) {
      setActiveId(stored)
    }
    // intentionally only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist selection
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (activeId && activeId !== 'new') {
      window.localStorage.setItem(ACTIVE_ACCOUNT_KEY, activeId)
    }
  }, [activeId])

  const activeAccount = useMemo(
    () => (activeId && activeId !== 'new' ? accounts.find((a) => a.id === activeId) ?? null : null),
    [activeId, accounts],
  )

  const [form, setForm] = useState<FormState>(() => {
    if (initialAccounts.length === 0) return defaultForm([])
    return fromAccount(initialAccounts[0])
  })

  const [settingsOpen, setSettingsOpen] = useState(initialAccounts.length === 0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // When the active selection changes, refresh the form
  useEffect(() => {
    if (activeId === 'new') {
      setForm(defaultForm(accounts.map((a) => a.name)))
      setSettingsOpen(true)
    } else if (activeAccount) {
      setForm(fromAccount(activeAccount))
    }
    setSaveError(null)
  }, [activeId, activeAccount, accounts])

  // numeric accessors
  const num = useMemo(() => ({
    account_size: form.account_size as AccountSize,
    starting_balance: parseFloat(form.starting_balance) || 0,
    current_balance: parseFloat(form.current_balance) || 0,
    todays_starting_balance: parseFloat(form.todays_starting_balance) || 0,
    highest_balance: parseFloat(form.highest_balance) || 0,
  }), [form])

  const config = APEX_CONFIGS[num.account_size] ?? APEX_CONFIGS[50000]

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      if (!form.name.trim()) {
        throw new Error('Account name is required')
      }
      // Auto-advance highest_balance if current eclipses it
      const newHighest = Math.max(num.highest_balance, num.current_balance)

      const payload = {
        user_id: userId,
        name: form.name.trim(),
        broker_account_id: form.broker_account_id.trim() || null,
        account_size: num.account_size,
        mode: form.mode,
        drawdown_type: form.drawdown_type,
        starting_balance: num.starting_balance,
        current_balance: num.current_balance,
        todays_starting_balance: num.todays_starting_balance,
        highest_balance: newHighest,
        purchase_date: form.purchase_date || null,
        updated_at: new Date().toISOString(),
      }

      if (activeId === 'new') {
        const { data, error } = await supabase
          .from('apex_accounts')
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        if (data) {
          const inserted = data as ApexAccount
          setAccounts((prev) => [...prev, inserted])
          setActiveId(inserted.id)
        }
      } else if (activeId) {
        const { data, error } = await supabase
          .from('apex_accounts')
          .update(payload)
          .eq('id', activeId)
          .select()
          .single()
        if (error) throw error
        if (data) {
          const updated = data as ApexAccount
          setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
        }
      }

      setForm((f) => ({ ...f, highest_balance: String(newHighest) }))
      setSettingsOpen(false)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [supabase, userId, form, num, activeId])

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async () => {
    if (!activeAccount) return
    if (!window.confirm(`Delete account "${activeAccount.name}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('apex_accounts')
        .delete()
        .eq('id', activeAccount.id)
      if (error) throw error
      const remaining = accounts.filter((a) => a.id !== activeAccount.id)
      setAccounts(remaining)
      setActiveId(remaining[0]?.id ?? 'new')
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }, [supabase, activeAccount, accounts])

  // ── Derived values ────────────────────────────────────────────────────────

  const profitEarned = num.current_balance - num.starting_balance
  const drawdownUsed = num.highest_balance - num.current_balance
  const drawdownRemaining = config.trailingDrawdown - drawdownUsed
  const todayLoss = num.todays_starting_balance - num.current_balance // positive = loss

  const daysRemaining = useMemo(() => {
    if (!form.purchase_date) return null
    try {
      const purchaseDate = parseISO(form.purchase_date)
      const deadline = addDays(purchaseDate, 30)
      return differenceInDays(deadline, new Date())
    } catch {
      return null
    }
  }, [form.purchase_date])

  // Trade list scoped to the active account
  const [trades, setTrades] = useState<Trade[]>(initialTrades)
  const accountTrades = useMemo(() => {
    if (!activeAccount) return [] as Trade[]
    return trades.filter((t) => t.account_id === activeAccount.id)
  }, [trades, activeAccount])

  const unassignedCount = useMemo(
    () => trades.filter((t) => t.account_id == null).length,
    [trades],
  )

  // Trade statistics from journal (scoped to the active account)
  const tradeStats = useMemo(() => {
    if (!accountTrades.length) {
      return { totalPnL: 0, tradingDays: 0, avgDailyPnL: 0, bestDayPnL: 0, bestDayDate: null as string | null, qualifyingDays: 0, consistencyPct: 0 }
    }

    const byDate = new Map<string, number>()
    for (const t of accountTrades) {
      byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.net_pnl)
    }

    const totalPnL = accountTrades.reduce((s, t) => s + t.net_pnl, 0)
    const tradingDays = byDate.size
    const avgDailyPnL = tradingDays > 0 ? totalPnL / tradingDays : 0

    let bestDayPnL = 0
    let bestDayDate: string | null = null
    let qualifyingDays = 0

    for (const [date, pnl] of Array.from(byDate.entries())) {
      if (pnl > bestDayPnL) { bestDayPnL = pnl; bestDayDate = date }
      if (pnl >= 50) qualifyingDays++
    }

    const consistencyPct = totalPnL > 0 ? (bestDayPnL / totalPnL) * 100 : 0

    return { totalPnL, tradingDays, avgDailyPnL, bestDayPnL, bestDayDate, qualifyingDays, consistencyPct }
  }, [accountTrades])

  // Bulk-assign all unassigned trades to the active account
  const [assigning, setAssigning] = useState(false)
  const handleAssignUnassigned = useCallback(async () => {
    if (!activeAccount || unassignedCount === 0) return
    if (!window.confirm(`Assign all ${unassignedCount} unassigned trade${unassignedCount === 1 ? '' : 's'} to "${activeAccount.name}"?`)) return
    setAssigning(true)
    try {
      const { error } = await supabase
        .from('trades')
        .update({ account_id: activeAccount.id })
        .eq('user_id', userId)
        .is('account_id', null)
      if (error) throw error
      setTrades((prev) => prev.map((t) => (t.account_id == null ? { ...t, account_id: activeAccount.id } : t)))
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Assign failed')
    } finally {
      setAssigning(false)
    }
  }, [activeAccount, unassignedCount, supabase, userId])

  // Eval pass readiness
  const passReady = form.mode === 'evaluation' &&
    profitEarned >= config.profitTarget &&
    drawdownRemaining > 0 &&
    (daysRemaining === null || daysRemaining >= 0)

  // PA safety net locked
  const safetyLocked = num.current_balance >= num.starting_balance + 100

  // ── Color helpers ─────────────────────────────────────────────────────────

  function profitBarColor(): 'green' | 'amber' | 'red' {
    const pct = config.profitTarget > 0 ? profitEarned / config.profitTarget : 0
    if (pct >= 0.8) return 'green'
    if (pct >= 0.5) return 'amber'
    return 'red'
  }

  function drawdownBarColor(): 'green' | 'amber' | 'red' {
    const bufferPct = config.trailingDrawdown > 0 ? drawdownRemaining / config.trailingDrawdown : 0
    if (bufferPct > 0.5) return 'green'
    if (bufferPct > 0.25) return 'amber'
    return 'red'
  }

  function dllBarColor(): 'green' | 'amber' | 'red' {
    if (todayLoss <= 0) return 'green'
    const remaining = config.dll - todayLoss
    if (remaining <= 150) return 'red'
    if (remaining <= 300) return 'amber'
    return 'green'
  }

  function deadlineTextColor() {
    if (daysRemaining === null) return 'text-gray-400'
    if (daysRemaining < 7) return 'text-red-400'
    if (daysRemaining <= 15) return 'text-amber-400'
    return 'text-emerald-400'
  }

  const accountLabel = `$${(form.account_size / 1000).toFixed(0)}K`
  const modeLabel = form.mode === 'evaluation' ? 'Eval' : 'PA'

  // Show tracker panels only when an existing account is selected (not when adding new)
  const showTracker = tableReady && activeId !== null && activeId !== 'new' && activeAccount !== null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      {/* Affirmation */}
      <p className="text-center text-sm italic text-gray-500 tracking-wide">
        I am a disciplined, patient and objective trader.
      </p>

      {/* Migration guide */}
      {!tableReady && <MigrationGuide />}

      {/* ── Account tabs ───────────────────────────────────────────────── */}
      {tableReady && (accounts.length > 0 || activeId === 'new') && (
        <div className="flex flex-wrap items-center gap-1.5">
          {accounts.map((a) => {
            const isActive = a.id === activeId
            const isPa = a.mode === 'pa'
            return (
              <button
                key={a.id}
                onClick={() => setActiveId(a.id)}
                className={cn(
                  'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition',
                  isActive
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800/60 border-gray-700 text-gray-300 hover:text-white hover:border-gray-600',
                )}
                title={`${a.name} · ${a.account_size / 1000}K ${isPa ? 'PA' : 'Eval'}`}
              >
                <span>{a.name}</span>
                <span className={cn(
                  'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded',
                  isActive
                    ? isPa ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'
                    : isPa ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400',
                )}>
                  {isPa ? 'PA' : 'Eval'}
                </span>
              </button>
            )
          })}
          <button
            onClick={() => setActiveId('new')}
            className={cn(
              'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition',
              activeId === 'new'
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800/40 border-dashed border-gray-700 text-gray-400 hover:text-white hover:border-gray-500',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Add account
          </button>
        </div>
      )}

      {/* ── Settings Panel ────────────────────────────────────────────── */}
      {tableReady && (
      <div className="border border-gray-700/50 rounded-xl overflow-hidden">
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/40 hover:bg-gray-800/60 transition"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">
              {activeId === 'new' ? 'New Account' : `${form.name} — Settings`}
            </span>
            <span className="text-[11px] text-gray-600 ml-1">
              {accountLabel} · {modeLabel} · {form.drawdown_type === 'intraday' ? 'Intraday' : 'EOD'}
            </span>
          </div>
          {settingsOpen
            ? <ChevronUp className="h-4 w-4 text-gray-500" />
            : <ChevronDown className="h-4 w-4 text-gray-500" />}
        </button>

        {settingsOpen && (
          <div className="p-4 space-y-4 border-t border-gray-700/50">

            {/* Account name + broker account id */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Account Name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. 50K Eval #1"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Tradovate Account ID
                  <span className="text-[10px] text-gray-600 normal-case font-normal ml-1">(for auto-matching imports)</span>
                </label>
                <input
                  type="text"
                  value={form.broker_account_id}
                  onChange={(e) => setForm(f => ({ ...f, broker_account_id: e.target.value }))}
                  placeholder="e.g. APEX-12345 or 67890"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Row 1: Account size + Mode */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Account Size
                </label>
                <select
                  value={form.account_size}
                  onChange={(e) => {
                    const size = Number(e.target.value) as AccountSize
                    setForm(f => ({
                      ...f,
                      account_size: size,
                      starting_balance: String(size),
                    }))
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ACCOUNT_SIZES.map(s => (
                    <option key={s} value={s}>
                      ${(s / 1000).toFixed(0)}K — ${APEX_CONFIGS[s].profitTarget.toLocaleString()} target
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Mode
                </label>
                <div className="flex h-[38px]">
                  {(['evaluation', 'pa'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setForm(f => ({ ...f, mode: m }))}
                      className={cn(
                        'flex-1 text-sm font-medium border transition',
                        m === 'evaluation' ? 'rounded-l-lg' : 'rounded-r-lg',
                        form.mode === m
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600',
                      )}
                    >
                      {m === 'evaluation' ? 'Evaluation' : 'PA'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2: Drawdown type + Purchase date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Drawdown Type
                </label>
                <div className="flex h-[38px]">
                  {(['intraday', 'eod'] as const).map(dt => (
                    <button
                      key={dt}
                      onClick={() => setForm(f => ({ ...f, drawdown_type: dt }))}
                      className={cn(
                        'flex-1 text-sm font-medium border transition',
                        dt === 'intraday' ? 'rounded-l-lg' : 'rounded-r-lg',
                        form.drawdown_type === dt
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600',
                      )}
                    >
                      {dt === 'intraday' ? 'Intraday' : 'EOD'}
                    </button>
                  ))}
                </div>
              </div>

              {form.mode === 'evaluation' && (
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                    Eval Purchase Date
                  </label>
                  <input
                    type="date"
                    value={form.purchase_date}
                    onChange={(e) => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}
            </div>

            {/* Balance fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Starting Balance
                </label>
                <input
                  type="number"
                  value={form.starting_balance}
                  onChange={(e) => setForm(f => ({ ...f, starting_balance: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Current Balance
                </label>
                <input
                  type="number"
                  value={form.current_balance}
                  onChange={(e) => setForm(f => ({ ...f, current_balance: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Today&apos;s Starting Balance
                </label>
                <input
                  type="number"
                  value={form.todays_starting_balance}
                  onChange={(e) => setForm(f => ({ ...f, todays_starting_balance: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                  Highest Balance{' '}
                  <span className="text-[10px] text-gray-600 normal-case font-normal">(auto-tracked)</span>
                </label>
                <input
                  type="number"
                  value={form.highest_balance}
                  onChange={(e) => setForm(f => ({ ...f, highest_balance: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {saveError && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {saveError}
              </p>
            )}

            <div className="flex gap-2">
              {activeId !== 'new' && activeAccount && (
                <button
                  onClick={handleDelete}
                  disabled={deleting || saving}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !tableReady}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white transition"
              >
                {saving ? 'Saving…' : activeId === 'new' ? 'Create Account' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Unassigned trades backfill prompt */}
      {showTracker && unassignedCount > 0 && (
        <div className="border border-amber-500/40 bg-amber-500/5 rounded-xl px-4 py-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-300">
              {unassignedCount} unassigned trade{unassignedCount === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              These won&apos;t appear in this account&apos;s stats until you assign them.
            </p>
          </div>
          <button
            onClick={handleAssignUnassigned}
            disabled={assigning}
            className="px-3 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 transition"
          >
            {assigning ? 'Assigning…' : `Assign to "${activeAccount?.name}"`}
          </button>
        </div>
      )}

      {/* Tracker panels — only when an existing account is selected */}
      {showTracker && (
        <>
          {/* ─────────────────── EVALUATION MODE ─────────────────────────── */}
          {form.mode === 'evaluation' && (
            <>
              {/* 1. Overall status banner */}
              {passReady ? (
                <div className="border border-emerald-500/40 bg-emerald-500/10 rounded-xl px-5 py-4 flex items-center gap-4">
                  <Trophy className="h-8 w-8 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-lg font-bold text-emerald-300">PASS READY ✓</p>
                    <p className="text-sm text-emerald-400/80 mt-0.5">
                      Profit target hit and account is in good standing. Request your funded account.
                    </p>
                  </div>
                </div>
              ) : (
                <SectionCard className={drawdownRemaining <= 0 ? 'border-red-500/40 bg-red-500/5' : ''}>
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-blue-400" />
                    <p className="text-sm font-semibold text-gray-200">Evaluation Status</p>
                  </div>
                  <div className="space-y-1.5 pl-6">
                    {/* Profit target condition */}
                    <div className="flex items-center gap-2">
                      {profitEarned >= config.profitTarget
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-gray-500 shrink-0" />}
                      <p className="text-xs text-gray-400">
                        Profit target: {formatCurrency(Math.max(0, profitEarned))} / {formatCurrency(config.profitTarget)}
                        {profitEarned < config.profitTarget && (
                          <span className="text-gray-600 ml-1">
                            ({formatCurrency(config.profitTarget - Math.max(0, profitEarned))} remaining)
                          </span>
                        )}
                      </p>
                    </div>
                    {/* Drawdown condition */}
                    <div className="flex items-center gap-2">
                      {drawdownRemaining > 0
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                      <p className={cn('text-xs', drawdownRemaining <= 0 ? 'text-red-400 font-medium' : 'text-gray-400')}>
                        {drawdownRemaining <= 0
                          ? 'Trailing drawdown exceeded — account failed'
                          : `Drawdown safe — ${formatCurrency(drawdownRemaining)} buffer remaining`}
                      </p>
                    </div>
                    {/* Deadline condition */}
                    {daysRemaining !== null && (
                      <div className="flex items-center gap-2">
                        {daysRemaining >= 0
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                          : <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                        <p className={cn('text-xs', daysRemaining < 0 ? 'text-red-400 font-medium' : 'text-gray-400')}>
                          {daysRemaining < 0 ? '30-day window expired' : `${daysRemaining} days remaining in window`}
                        </p>
                      </div>
                    )}
                  </div>
                </SectionCard>
              )}

              {/* 2. Profit target progress */}
              <SectionCard>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-gray-400" />
                    <p className="text-sm font-semibold text-gray-200">Profit Target</p>
                  </div>
                  <p className={cn(
                    'text-sm font-bold',
                    profitEarned >= config.profitTarget ? 'text-emerald-400' : 'text-gray-300',
                  )}>
                    {formatCurrency(profitEarned)} / {formatCurrency(config.profitTarget)}
                  </p>
                </div>
                <ProgressBar value={Math.max(0, profitEarned)} max={config.profitTarget} color={profitBarColor()} />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{Math.round(Math.max(0, profitEarned / config.profitTarget) * 100)}% complete</span>
                  <span>
                    {profitEarned >= config.profitTarget
                      ? 'Target hit ✓'
                      : `${formatCurrency(config.profitTarget - Math.max(0, profitEarned))} to go`}
                  </span>
                </div>
              </SectionCard>

              {/* 3. Trailing drawdown safety */}
              <SectionCard className={cn(
                drawdownRemaining <= 0
                  ? 'border-red-500/40 bg-red-500/5'
                  : drawdownRemaining <= 200
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : '',
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className={cn(
                      'h-4 w-4',
                      drawdownRemaining <= 0 ? 'text-red-400' : drawdownRemaining <= 200 ? 'text-amber-400' : 'text-gray-400',
                    )} />
                    <p className="text-sm font-semibold text-gray-200">
                      {form.drawdown_type === 'intraday' ? 'Intraday Trailing' : 'EOD Trailing'} Drawdown
                    </p>
                  </div>
                  <p className={cn(
                    'text-sm font-bold',
                    drawdownRemaining <= 0 ? 'text-red-400' : drawdownRemaining <= 200 ? 'text-amber-400' : 'text-gray-300',
                  )}>
                    {formatCurrency(Math.max(0, drawdownRemaining))} buffer
                  </p>
                </div>
                <ProgressBar value={Math.max(0, drawdownRemaining)} max={config.trailingDrawdown} color={drawdownBarColor()} />
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-gray-500">Peak Balance</p>
                    <p className="text-white font-medium">{formatCurrency(num.highest_balance)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Current</p>
                    <p className="text-white font-medium">{formatCurrency(num.current_balance)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Floor</p>
                    <p className={cn('font-medium', drawdownBarColor() === 'red' ? 'text-red-400' : 'text-white')}>
                      {formatCurrency(num.highest_balance - config.trailingDrawdown)}
                    </p>
                  </div>
                </div>
                {drawdownRemaining <= 200 && drawdownRemaining > 0 && (
                  <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-300">
                      Within {formatCurrency(drawdownRemaining)} of threshold. Reduce size immediately.
                    </p>
                  </div>
                )}
                {form.drawdown_type === 'intraday' && (
                  <p className="text-[11px] text-gray-600 flex items-center gap-1">
                    <Info className="h-3 w-3 shrink-0" />
                    Intraday: peak balance trails tick-by-tick. Update current balance after each session.
                  </p>
                )}
              </SectionCard>

              {/* 4. Daily Loss Limit — EOD accounts only */}
              {form.drawdown_type === 'eod' && (
                <SectionCard className={cn(
                  dllBarColor() === 'red' ? 'border-red-500/40 bg-red-500/5' :
                  dllBarColor() === 'amber' ? 'border-amber-500/40 bg-amber-500/5' : '',
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-gray-400" />
                      <p className="text-sm font-semibold text-gray-200">Daily Loss Limit (EOD)</p>
                    </div>
                    <p className={cn(
                      'text-sm font-bold',
                      todayLoss <= 0 ? 'text-emerald-400' :
                      dllBarColor() === 'red' ? 'text-red-400' :
                      dllBarColor() === 'amber' ? 'text-amber-400' : 'text-gray-300',
                    )}>
                      {todayLoss <= 0
                        ? `+${formatCurrency(Math.abs(todayLoss))} today`
                        : `${formatCurrency(todayLoss)} loss`}
                    </p>
                  </div>
                  <ProgressBar value={Math.max(0, todayLoss)} max={config.dll} color={dllBarColor()} />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>DLL: {formatCurrency(config.dll)}</span>
                    <span>
                      {todayLoss <= 0
                        ? 'Profitable session'
                        : `${formatCurrency(config.dll - todayLoss)} before trading pauses`}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600 flex items-center gap-1">
                    <Info className="h-3 w-3 shrink-0" />
                    Hitting DLL pauses trading for the day but does NOT fail the account.
                    Reset by updating &ldquo;Today&apos;s Starting Balance&rdquo; each session.
                  </p>
                </SectionCard>
              )}

              {/* 5. 30-day deadline */}
              <SectionCard className={cn(
                daysRemaining !== null && daysRemaining < 7 ? 'border-red-500/40 bg-red-500/5' :
                daysRemaining !== null && daysRemaining <= 15 ? 'border-amber-500/40 bg-amber-500/5' : '',
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-gray-400" />
                    <p className="text-sm font-semibold text-gray-200">30-Day Deadline</p>
                  </div>
                  <p className={cn('text-sm font-bold', deadlineTextColor())}>
                    {daysRemaining === null
                      ? 'Set purchase date'
                      : daysRemaining > 0
                      ? `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`
                      : 'Window expired'}
                  </p>
                </div>
                {daysRemaining !== null && daysRemaining >= 0 && (
                  <ProgressBar
                    value={daysRemaining}
                    max={30}
                    color={daysRemaining < 7 ? 'red' : daysRemaining <= 15 ? 'amber' : 'green'}
                  />
                )}
                {form.purchase_date && daysRemaining !== null && daysRemaining >= 0 && (
                  <p className="text-xs text-gray-500">
                    Deadline: {format(addDays(parseISO(form.purchase_date), 30), 'MMMM d, yyyy')}
                  </p>
                )}
                <p className="text-[11px] text-gray-600 flex items-center gap-1">
                  <Info className="h-3 w-3 shrink-0" />
                  No minimum trading days — Apex 4.0. Pass in a single session if the profit target is hit.
                </p>
              </SectionCard>

              {/* 6. Auto-calculated stats from journal */}
              <SectionCard>
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-gray-400" />
                  <p className="text-sm font-semibold text-gray-200">Session Stats (from journal)</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatPill label="Trading Days" value={String(tradeStats.tradingDays)} sub="sessions logged" />
                  <StatPill label="Journal P&L" value={formatCurrency(tradeStats.totalPnL)} sub="net from trades" />
                  <StatPill label="Avg Daily" value={formatCurrency(tradeStats.avgDailyPnL)} sub="per session" />
                  <StatPill
                    label="Best Session"
                    value={formatCurrency(tradeStats.bestDayPnL)}
                    sub={tradeStats.bestDayDate ? format(parseISO(tradeStats.bestDayDate), 'MM/dd') : '—'}
                  />
                </div>
                <p className="text-[11px] text-gray-600 flex items-center gap-1">
                  <Info className="h-3 w-3 shrink-0" />
                  Journal P&L includes only trades assigned to this account. Current balance in Settings is the source of truth for drawdown tracking.
                </p>
              </SectionCard>
            </>
          )}

          {/* ─────────────────── PA MODE ──────────────────────────────────── */}
          {form.mode === 'pa' && (
            <>
              {/* 1. Safety net status */}
              <div className={cn(
                'border rounded-xl px-5 py-4 flex items-center gap-4',
                safetyLocked
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : 'border-amber-500/40 bg-amber-500/5',
              )}>
                {safetyLocked
                  ? <Lock className="h-7 w-7 text-emerald-400 shrink-0" />
                  : <Unlock className="h-7 w-7 text-amber-400 shrink-0" />}
                <div>
                  <p className={cn('text-base font-bold', safetyLocked ? 'text-emerald-300' : 'text-amber-300')}>
                    {safetyLocked ? 'Drawdown Floor Locked ✓  —  Full Size Active' : 'Drawdown Still Trailing  —  Half Size Active'}
                  </p>
                  <p className={cn('text-xs mt-0.5', safetyLocked ? 'text-emerald-400/70' : 'text-amber-400/70')}>
                    {safetyLocked
                      ? `Floor locked at ${formatCurrency(num.highest_balance - config.trailingDrawdown)}. Trade full size.`
                      : `Need ${formatCurrency(Math.max(0, num.starting_balance + 100 - num.current_balance))} more profit to lock floor. Half size until then.`}
                  </p>
                </div>
              </div>

              {/* PA drawdown tracker */}
              <SectionCard className={cn(
                drawdownRemaining <= 0 ? 'border-red-500/40 bg-red-500/5' :
                drawdownRemaining <= 200 ? 'border-amber-500/40 bg-amber-500/5' : '',
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className={cn(
                      'h-4 w-4',
                      drawdownRemaining <= 0 ? 'text-red-400' : drawdownRemaining <= 200 ? 'text-amber-400' : 'text-gray-400',
                    )} />
                    <p className="text-sm font-semibold text-gray-200">
                      {form.drawdown_type === 'intraday' ? 'Intraday Trailing' : 'EOD Trailing'} Drawdown
                    </p>
                    {safetyLocked && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                        locked
                      </span>
                    )}
                  </div>
                  <p className={cn(
                    'text-sm font-bold',
                    drawdownRemaining <= 0 ? 'text-red-400' : drawdownRemaining <= 200 ? 'text-amber-400' : 'text-gray-300',
                  )}>
                    {formatCurrency(Math.max(0, drawdownRemaining))} buffer
                  </p>
                </div>
                <ProgressBar value={Math.max(0, drawdownRemaining)} max={config.trailingDrawdown} color={drawdownBarColor()} />
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <p className="text-gray-500">Peak Balance</p>
                    <p className="text-white font-medium">{formatCurrency(num.highest_balance)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Current</p>
                    <p className="text-white font-medium">{formatCurrency(num.current_balance)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">{safetyLocked ? 'Fixed Floor' : 'Current Floor'}</p>
                    <p className="text-white font-medium">{formatCurrency(num.highest_balance - config.trailingDrawdown)}</p>
                  </div>
                </div>
                {drawdownRemaining <= 200 && drawdownRemaining > 0 && (
                  <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-300">
                      Within {formatCurrency(drawdownRemaining)} of threshold. Reduce size immediately.
                    </p>
                  </div>
                )}
              </SectionCard>

              {/* 2. 50% consistency rule */}
              <SectionCard className={cn(
                tradeStats.consistencyPct > 50 ? 'border-red-500/40 bg-red-500/5' : '',
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-gray-400" />
                    <p className="text-sm font-semibold text-gray-200">50% Consistency Rule</p>
                  </div>
                  <p className={cn(
                    'text-sm font-bold',
                    tradeStats.consistencyPct > 50 ? 'text-red-400' :
                    tradeStats.consistencyPct > 40 ? 'text-amber-400' : 'text-emerald-400',
                  )}>
                    {tradeStats.consistencyPct.toFixed(1)}%
                  </p>
                </div>
                <ProgressBar
                  value={tradeStats.consistencyPct}
                  max={100}
                  color={tradeStats.consistencyPct > 50 ? 'red' : tradeStats.consistencyPct > 40 ? 'amber' : 'green'}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>
                    Best day: {formatCurrency(tradeStats.bestDayPnL)}
                    {tradeStats.bestDayDate && ` (${format(parseISO(tradeStats.bestDayDate), 'MM/dd')})`}
                  </span>
                  <span>Total: {formatCurrency(tradeStats.totalPnL)}</span>
                </div>
                {tradeStats.consistencyPct > 50 && (
                  <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    <p className="text-xs text-red-300">
                      Best day exceeds 50% of total profit. Payout will be denied — need more qualifying sessions.
                    </p>
                  </div>
                )}
                <p className="text-[11px] text-gray-600 flex items-center gap-1">
                  <Info className="h-3 w-3 shrink-0" />
                  This rule is checked at payout request time only. No single day &gt; 50% of total profit.
                </p>
              </SectionCard>

              {/* 3. Payout qualifying days */}
              <SectionCard>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-gray-400" />
                    <p className="text-sm font-semibold text-gray-200">Payout Qualifying Days</p>
                  </div>
                  <p className={cn(
                    'text-sm font-bold',
                    tradeStats.qualifyingDays >= 5 ? 'text-emerald-400' :
                    tradeStats.qualifyingDays >= 3 ? 'text-amber-400' : 'text-gray-300',
                  )}>
                    {tradeStats.qualifyingDays} / 5
                  </p>
                </div>
                <ProgressBar
                  value={tradeStats.qualifyingDays}
                  max={5}
                  color={tradeStats.qualifyingDays >= 5 ? 'green' : tradeStats.qualifyingDays >= 3 ? 'amber' : 'red'}
                />
                <p className="text-xs text-gray-500">
                  Qualifying days = sessions with ≥ $50 net profit. Need 5 per payout request.
                </p>
                {tradeStats.qualifyingDays >= 5 && (
                  <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <p className="text-xs text-emerald-300">
                      5 qualifying days reached. Verify consistency rule before submitting payout request.
                    </p>
                  </div>
                )}
                <p className="text-[11px] text-gray-600 flex items-center gap-1">
                  <Info className="h-3 w-3 shrink-0" />
                  Payout caps increase with each payout. All caps removed after your 6th payout.
                </p>
              </SectionCard>

              {/* 4. PA stats */}
              <SectionCard>
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-gray-400" />
                  <p className="text-sm font-semibold text-gray-200">Account Stats (from journal)</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatPill label="Trading Days" value={String(tradeStats.tradingDays)} sub="sessions logged" />
                  <StatPill label="Journal P&L" value={formatCurrency(tradeStats.totalPnL)} sub="net from trades" />
                  <StatPill label="Avg Daily" value={formatCurrency(tradeStats.avgDailyPnL)} sub="per session" />
                  <StatPill label="Qualifying" value={String(tradeStats.qualifyingDays)} sub="≥ $50 days" />
                </div>
              </SectionCard>
            </>
          )}
        </>
      )}
    </div>
  )
}
