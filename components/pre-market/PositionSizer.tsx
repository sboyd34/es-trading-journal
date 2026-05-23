'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { APEX_CONFIGS, ACCOUNT_SIZES, RISK_RULES, type AccountSize } from '@/lib/apex-config'
import { POINT_VALUES } from '@/lib/tradovate-parser'
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
      const rules = RISK_RULES[selectedAccount.mode]
      return {
        accountSize: size,
        mode: selectedAccount.mode,
        maxContracts: cfg.maxContracts,
        softStop: rules.softStop,
        hardStop: rules.hardStop,
      }
    }
    const cfg = APEX_CONFIGS[manualSize]
    const rules = RISK_RULES[manualMode]
    return {
      accountSize: manualSize,
      mode: manualMode,
      maxContracts: cfg.maxContracts,
      softStop: rules.softStop,
      hardStop: rules.hardStop,
    }
  }, [selectedAccount, manualSize, manualMode])

  const result = useMemo((): SizerResult | null => {
    const entry = parseFloat(entryPrice)
    const stop = parseFloat(stopPrice)
    if (isNaN(entry) || isNaN(stop)) return null
    const stopPoints = Math.abs(entry - stop)
    if (stopPoints === 0) return null
    const pointValue = POINT_VALUES[instrument] ?? 50
    const riskPerContract = stopPoints * pointValue
    const softContracts = Math.min(maxContracts, Math.floor(softStop / riskPerContract))
    const hardContracts = Math.min(maxContracts, Math.floor(hardStop / riskPerContract))
    return {
      stopPoints,
      riskPerContract,
      softContracts,
      hardContracts,
      maxContracts,
      totalRiskSoft: softContracts * riskPerContract,
      softStop,
      hardStop,
      tooWide: softContracts === 0,
    }
  }, [entryPrice, stopPrice, instrument, softStop, hardStop, maxContracts])

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

              {result.tooWide ? (
                <p className="text-sm font-semibold text-red-400">
                  Stop too wide — reduce stop or switch to MES
                </p>
              ) : (
                <p className={cn(
                  'text-sm font-semibold',
                  result.softContracts === result.maxContracts ? 'text-amber-400' : 'text-emerald-400'
                )}>
                  Soft stop (${result.softStop}) → {result.softContracts} {instrument}
                  <span className="text-xs font-normal text-gray-500 ml-1">(max {result.maxContracts})</span>
                </p>
              )}

              {!result.tooWide && (
                <p className="text-xs text-gray-500">
                  Hard stop (${result.hardStop}) → {result.hardContracts} {instrument}
                </p>
              )}

              {!result.tooWide && (
                <p className="text-xs text-gray-400">
                  Total risk (soft):{' '}
                  <span className="text-gray-200 font-medium">${result.totalRiskSoft.toFixed(2)}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
