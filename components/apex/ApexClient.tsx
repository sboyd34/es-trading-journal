'use client'

import { useState, useMemo, useCallback } from 'react'
import { Trade, ApexSettings } from '@/types'
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
} from 'lucide-react'

// ── Apex 4.0 account configurations ─────────────────────────────────────────

const APEX_CONFIGS = {
  25000:  { profitTarget: 1500,  trailingDrawdown: 1000, dll: 500,  maxContracts: 4  },
  50000:  { profitTarget: 3000,  trailingDrawdown: 2000, dll: 1000, maxContracts: 6  },
  100000: { profitTarget: 6000,  trailingDrawdown: 3000, dll: 1500, maxContracts: 8  },
  150000: { profitTarget: 9000,  trailingDrawdown: 4000, dll: 2000, maxContracts: 12 },
} as const

type AccountSize = keyof typeof APEX_CONFIGS
const ACCOUNT_SIZES = [25000, 50000, 100000, 150000] as AccountSize[]

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

const MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS apex_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
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
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id)
);
ALTER TABLE apex_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own apex settings" ON apex_settings
  FOR ALL USING (auth.uid() = user_id);`

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
  initialSettings: ApexSettings | null
  initialTrades: Trade[]
  tableReady: boolean
}

interface FormState {
  account_size: number
  mode: 'evaluation' | 'pa'
  drawdown_type: 'eod' | 'intraday'
  starting_balance: string
  current_balance: string
  todays_starting_balance: string
  highest_balance: string
  purchase_date: string
}

function toFormState(s: ApexSettings | null): FormState {
  return {
    account_size: s?.account_size ?? 50000,
    mode: s?.mode ?? 'evaluation',
    drawdown_type: s?.drawdown_type ?? 'intraday',
    starting_balance: String(s?.starting_balance ?? 50000),
    current_balance: String(s?.current_balance ?? 50000),
    todays_starting_balance: String(s?.todays_starting_balance ?? 50000),
    highest_balance: String(s?.highest_balance ?? 50000),
    purchase_date: s?.purchase_date ?? '',
  }
}

export default function ApexClient({ userId, initialSettings, initialTrades, tableReady }: ApexClientProps) {
  const supabase = createClient()

  const [form, setForm] = useState<FormState>(() => toFormState(initialSettings))
  const [settingsOpen, setSettingsOpen] = useState(!initialSettings)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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
      // Auto-advance highest_balance if current eclipses it
      const newHighest = Math.max(num.highest_balance, num.current_balance)

      const payload = {
        user_id: userId,
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

      const { error } = await supabase
        .from('apex_settings')
        .upsert(payload, { onConflict: 'user_id' })

      if (error) throw error

      setForm(f => ({ ...f, highest_balance: String(newHighest) }))
      setSettingsOpen(false)
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [supabase, userId, form, num])

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

  // Trade statistics from journal
  const tradeStats = useMemo(() => {
    if (!initialTrades.length) {
      return { totalPnL: 0, tradingDays: 0, avgDailyPnL: 0, bestDayPnL: 0, bestDayDate: null as string | null, qualifyingDays: 0, consistencyPct: 0 }
    }

    const byDate = new Map<string, number>()
    for (const t of initialTrades) {
      byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.net_pnl)
    }

    const totalPnL = initialTrades.reduce((s, t) => s + t.net_pnl, 0)
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
  }, [initialTrades])

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10">
      {/* Affirmation */}
      <p className="text-center text-sm italic text-gray-500 tracking-wide">
        I am a disciplined, patient and objective trader.
      </p>

      {/* Migration guide */}
      {!tableReady && <MigrationGuide />}

      {/* ── Settings Panel ────────────────────────────────────────────── */}
      <div className="border border-gray-700/50 rounded-xl overflow-hidden">
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gray-800/40 hover:bg-gray-800/60 transition"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">Account Settings</span>
            <span className="text-[11px] text-gray-600 ml-1">
              {accountLabel} · {form.mode === 'evaluation' ? 'Eval' : 'PA'} · {form.drawdown_type === 'intraday' ? 'Intraday' : 'EOD'}
            </span>
          </div>
          {settingsOpen
            ? <ChevronUp className="h-4 w-4 text-gray-500" />
            : <ChevronDown className="h-4 w-4 text-gray-500" />}
        </button>

        {settingsOpen && (
          <div className="p-4 space-y-4 border-t border-gray-700/50">

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

            <button
              onClick={handleSave}
              disabled={saving || !tableReady}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold text-white transition"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>

      {/* Only show tracker panels once table is ready */}
      {tableReady && (
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
                  Journal P&L is for reference only. Current balance in Settings is the source of truth for drawdown tracking.
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
