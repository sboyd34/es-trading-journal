'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { APEX_CONFIGS, ACCOUNT_SIZES, ES_BRACKET, MES_BRACKET, planFor, type AccountSize } from '@/lib/apex-config'
import { POINT_VALUES } from '@/lib/instruments'
import type { ApexAccount } from '@/types'

type Instrument = 'ES' | 'MES' | 'NQ' | 'MNQ'

type SizerResult = {
  stopPoints: number
  riskPerContract: number
  softContracts: number
  hardContracts: number
  maxContracts: number
  totalRiskSoft: number
  softStop: number
  hardStop: number
  tooWide: boolean
  // ES is governed by the plan's /ES rule, not just by dollars.
  esBlocked: string | null
  esNote: string | null
}

// Pure sizing math, kept outside the component so it can be exercised directly.
export function computeSizing(p: {
  entryPrice: string
  stopPrice: string
  instrument: Instrument
  accountSize: AccountSize
  mode: 'evaluation' | 'pa'
  softStop: number
  hardStop: number
  maxContracts: number
}): SizerResult | null {
  const { instrument, accountSize, mode, softStop, hardStop, maxContracts } = p
  const entry = parseFloat(p.entryPrice)
  const stop = parseFloat(p.stopPrice)
  if (isNaN(entry) || isNaN(stop)) return null
  const stopPoints = Math.abs(entry - stop)
  if (stopPoints === 0) return null
  const pointValue = POINT_VALUES[instrument] ?? 50
  const riskPerContract = stopPoints * pointValue
  // maxContracts is in minis; Apex counts 10 micros per mini.
  let cap = instrument === 'MES' || instrument === 'MNQ' ? maxContracts * 10 : maxContracts

  // /ES rule from the plan: 1 contract on the 50K (eval or PA); on the 25K
  // only in PA phase 2. A tight stop must not talk the sizer past it.
  let esBlocked: string | null = null
  let esNote: string | null = null
  if (instrument === 'ES') {
    const plan = planFor(accountSize)
    cap = Math.min(cap, plan.es.maxContracts)
    if (plan.es.allowed === 'pa-phase-2' && mode === 'evaluation') {
      esBlocked = `No /ES on the ${accountSize / 1000}K eval — 1 ES at 8 ticks risks $100, over the $${hardStop} max. Use MES.`
    } else if (plan.es.allowed === 'pa-phase-2') {
      esNote = `PA phase 2 only — trail locked at $${plan.paTrailLocksAt.toLocaleString()} with $1,500+ above it. ATR under 6.`
    } else {
      esNote = `Max 1 ES · ${ES_BRACKET.stopTicks}-tick stop / ${ES_BRACKET.targetTicks}-tick target. ATR under 6 — else MES.`
    }
  }

  // /MES is a fixed 2-contract bracket (MES_BRACKET), not sized up to the risk
  // band — its $40 risk sits deliberately below the plan's band.
  if (instrument === 'MES') {
    cap = Math.min(cap, MES_BRACKET.contracts)
    esNote = `MES bracket: ${MES_BRACKET.contracts} contracts, ${MES_BRACKET.stopTicks}-tick stop each; ` +
      `targets +${MES_BRACKET.targetTicks[0]}t / +${MES_BRACKET.targetTicks[1]}t.`
  }

  const softContracts = esBlocked ? 0 : Math.min(cap, Math.floor(softStop / riskPerContract))
  const hardContracts = esBlocked ? 0 : Math.min(cap, Math.floor(hardStop / riskPerContract))
  return {
    stopPoints,
    riskPerContract,
    softContracts,
    hardContracts,
    maxContracts: cap,
    totalRiskSoft: softContracts * riskPerContract,
    softStop,
    hardStop,
    // The plan's band runs base → max, so a stop is only "too wide" when
    // even the max risk can't afford one contract.
    tooWide: hardContracts === 0,
    esBlocked,
    esNote,
  }
}

export default function PositionSizer() {
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState<ApexAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [manualSize, setManualSize] = useState<AccountSize>(50000)
  const [manualMode, setManualMode] = useState<'evaluation' | 'pa'>('evaluation')
  const [instrument, setInstrument] = useState<Instrument>('ES')
  const [entryPrice, setEntryPrice] = useState('')
  const [stopPrice, setStopPrice] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const { data } = await supabase
        .from('apex_accounts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at')
      if (!cancelled && data) {
        const rows = data as ApexAccount[]
        setAccounts(rows)
        if (rows.length > 0) setSelectedAccountId(rows[0].id)
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  )

  const { accountSize, mode, maxContracts, softStop, hardStop } = useMemo(() => {
    if (selectedAccount) {
      const size = selectedAccount.account_size as AccountSize
      const cfg = APEX_CONFIGS[size] ?? APEX_CONFIGS[50000]
      // Per-trade risk band from the trading plan. Eval and PA phase 1 share it.
      const risk = planFor(size).riskPerTrade
      return {
        accountSize: size,
        mode: selectedAccount.mode,
        maxContracts: cfg.maxContracts,
        softStop: risk.min,
        hardStop: risk.max,
      }
    }
    const cfg = APEX_CONFIGS[manualSize]
    const risk = planFor(manualSize).riskPerTrade
    return {
      accountSize: manualSize,
      mode: manualMode,
      maxContracts: cfg.maxContracts,
      softStop: risk.min,
      hardStop: risk.max,
    }
  }, [selectedAccount, manualSize, manualMode])

  const result = useMemo(
    () => computeSizing({ entryPrice, stopPrice, instrument, accountSize, mode, softStop, hardStop, maxContracts }),
    [entryPrice, stopPrice, instrument, softStop, hardStop, maxContracts, accountSize, mode],
  )

  const pillLabel = useMemo(() => {
    if (selectedAccount) return selectedAccount.name
    return `${(accountSize / 1000).toFixed(0)}K ${mode === 'evaluation' ? 'Eval' : 'PA'}`
  }, [selectedAccount, accountSize, mode])

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-700/30 transition"
      >
        {open ? (
          <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        )}
        <span className="text-sm font-semibold text-gray-200">Position Sizing</span>
        <span className="ml-auto text-xs font-medium text-gray-400 bg-gray-700/60 px-2.5 py-0.5 rounded-full">
          {pillLabel}
        </span>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-700/50 pt-4">

          {/* Account + instrument row */}
          <div className="flex flex-wrap gap-3 items-end">
            {accounts.length > 0 ? (
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-400 mb-1">Account</label>
                <select
                  value={selectedAccountId ?? ''}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {(a.account_size / 1000).toFixed(0)}K · {a.mode === 'evaluation' ? 'Eval' : 'PA'}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Account Size</label>
                  <select
                    value={manualSize}
                    onChange={(e) => setManualSize(Number(e.target.value) as AccountSize)}
                    className="bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {ACCOUNT_SIZES.map((s) => (
                      <option key={s} value={s}>{(s / 1000).toFixed(0)}K</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">Mode</label>
                  <div className="flex rounded-lg overflow-hidden border border-gray-700/50">
                    {(['evaluation', 'pa'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setManualMode(m)}
                        className={cn(
                          'px-3 py-2 text-xs font-medium transition',
                          manualMode === m ? 'bg-blue-600 text-white' : 'bg-gray-900/60 text-gray-400 hover:text-white'
                        )}
                      >
                        {m === 'evaluation' ? 'Eval' : 'PA'}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Instrument toggle */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Instrument</label>
              <div className="flex rounded-lg overflow-hidden border border-gray-700/50">
                {(['ES', 'MES', 'NQ', 'MNQ'] as const).map((ins) => (
                  <button
                    key={ins}
                    onClick={() => setInstrument(ins)}
                    className={cn(
                      'px-3 py-2 text-xs font-medium transition',
                      instrument === ins ? 'bg-blue-600 text-white' : 'bg-gray-900/60 text-gray-400 hover:text-white'
                    )}
                  >
                    {ins}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Price inputs */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">Entry Price</label>
              <input
                type="number"
                step="0.25"
                placeholder="5100.25"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                className="w-full bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">Stop Price</label>
              <input
                type="number"
                step="0.25"
                placeholder="5097.75"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                className="w-full bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Results — only when both inputs are valid */}
          {result && (
            <div className="bg-gray-900/60 border border-gray-700/40 rounded-lg px-4 py-3 space-y-2">
              <p className="text-xs text-gray-400">
                Stop:{' '}
                <span className="text-gray-200 font-medium">{result.stopPoints.toFixed(2)} pts</span>
                <span className="mx-2 text-gray-600">·</span>
                Risk/contract:{' '}
                <span className="text-gray-200 font-medium">${result.riskPerContract.toFixed(2)}</span>
              </p>

              {result.esBlocked ? (
                <p className="text-sm font-semibold text-red-400">{result.esBlocked}</p>
              ) : result.tooWide ? (
                <p className="text-sm font-semibold text-red-400">
                  Stop too wide — reduce stop or switch to MES
                </p>
              ) : (
                <p className={cn(
                  'text-sm font-semibold',
                  result.softContracts === result.maxContracts ? 'text-amber-400' : 'text-emerald-400'
                )}>
                  Base risk (${result.softStop}) → {result.softContracts} {instrument}
                  <span className="text-xs font-normal text-gray-500 ml-1">(max {result.maxContracts})</span>
                </p>
              )}

              {!result.tooWide && (
                <p className="text-xs text-gray-500">
                  Max risk (${result.hardStop}) → {result.hardContracts} {instrument}
                </p>
              )}

              {!result.tooWide && (
                <p className="text-xs text-gray-400">
                  Total risk (base):{' '}
                  <span className="text-gray-200 font-medium">${result.totalRiskSoft.toFixed(2)}</span>
                </p>
              )}

              {!result.esBlocked && !result.tooWide && result.esNote && (
                <p className="text-xs text-amber-400/90">{result.esNote}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
