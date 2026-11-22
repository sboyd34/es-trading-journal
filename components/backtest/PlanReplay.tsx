'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency } from '@/lib/utils'
import { ctTimeLabel } from '@/lib/trade-flags'
import { replayPlan } from '@/lib/plan-replay'
import type { ApexAccount, Trade } from '@/types'
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'

// Plan Replay — your real journal trades re-run under the trading plan's
// daily rules (lib/plan-replay). Answers "what is the plan costing me, and
// what is it saving me?" from data you already have.

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: 'pos' | 'neg'; sub?: string }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={cn('text-xl font-bold mt-1 tabular-nums',
        tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-gray-100')}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${formatCurrency(Math.abs(v))}`

export default function PlanReplay() {
  const supabase = createClient()
  const [trades, setTrades] = useState<Trade[]>([])
  const [accounts, setAccounts] = useState<ApexAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: t }, { data: a }] = await Promise.all([
        supabase.from('trades').select('*').eq('user_id', user.id),
        supabase.from('apex_accounts').select('*').eq('user_id', user.id),
      ])
      if (cancelled) return
      setTrades((t as Trade[]) || [])
      setAccounts((a as ApexAccount[]) || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [supabase])

  const replay = useMemo(() => replayPlan(trades, accounts), [trades, accounts])

  if (loading) return <p className="text-sm text-gray-500">Loading trades…</p>
  if (replay.days.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No account-linked trades to replay yet. Import trades into an Apex account and they appear here.
      </p>
    )
  }

  const diff = replay.plan - replay.actual
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div className="space-y-5">
      <div className="bg-gray-800/30 border border-gray-700/50 rounded-xl px-5 py-4 flex gap-3">
        <ShieldCheck className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
        <p className="text-sm text-gray-300 leading-relaxed">
          Your real trades, re-run under the plan&apos;s daily rules — hard daily stop, two losers, profit
          target. The first rule that fires ends the day; everything after it is skipped. Size rules (ES on the
          25K eval, a loss over the per-trade max) are <span className="text-amber-300">flagged</span>, not re-priced.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Actual P&L" value={signed(replay.actual)} tone={replay.actual >= 0 ? 'pos' : 'neg'} />
        <Stat label="Under the plan" value={signed(replay.plan)} tone={replay.plan >= 0 ? 'pos' : 'neg'}
          sub={`${signed(diff)} vs actual`} />
        <Stat label="Losses avoided" value={formatCurrency(Math.abs(replay.skippedLosers))} tone="pos"
          sub="losing trades the plan skipped" />
        <Stat label="Winners missed" value={formatCurrency(replay.skippedWinners)} tone="neg"
          sub="winning trades the plan skipped" />
      </div>

      {(replay.flaggedTrades > 0 || replay.unlinked > 0) && (
        <p className="text-xs text-gray-500">
          {replay.flaggedTrades > 0 && <span className="text-amber-300/90">{replay.flaggedTrades} trade{replay.flaggedTrades !== 1 ? 's' : ''} broke a size rule. </span>}
          {replay.unlinked > 0 && `${replay.unlinked} trade${replay.unlinked !== 1 ? 's' : ''} with no linked account not replayed.`}
        </p>
      )}

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700/50 text-xs text-gray-400">
              <th className="text-left px-4 py-3 font-semibold">Day</th>
              <th className="text-left px-4 py-3 font-semibold">Account</th>
              <th className="text-right px-4 py-3 font-semibold">Taken</th>
              <th className="text-right px-4 py-3 font-semibold">Actual</th>
              <th className="text-right px-4 py-3 font-semibold">Plan</th>
              <th className="text-right px-4 py-3 font-semibold">Plan vs actual</th>
              <th className="text-left px-4 py-3 font-semibold">Stopped by</th>
            </tr>
          </thead>
          <tbody>
            {replay.days.map((d) => {
              const key = `${d.date}|${d.accountId}`
              const isOpen = open.has(key)
              const delta = d.plan - d.actual
              return [
                <tr key={key} onClick={() => toggle(key)}
                  className="border-b border-gray-700/30 hover:bg-gray-700/20 cursor-pointer">
                  <td className="px-4 py-2.5 text-gray-200 whitespace-nowrap">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 inline mr-1 text-gray-500" /> : <ChevronRight className="h-3.5 w-3.5 inline mr-1 text-gray-500" />}
                    {d.date}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">{d.accountName}</td>
                  <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums">
                    {d.trades.filter((t) => t.taken).length}/{d.trades.length}
                  </td>
                  <td className={cn('px-4 py-2.5 text-right tabular-nums', d.actual >= 0 ? 'text-emerald-400' : 'text-red-400')}>{signed(d.actual)}</td>
                  <td className={cn('px-4 py-2.5 text-right tabular-nums', d.plan >= 0 ? 'text-emerald-400' : 'text-red-400')}>{signed(d.plan)}</td>
                  <td className={cn('px-4 py-2.5 text-right tabular-nums', delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-gray-500')}>
                    {delta === 0 ? '—' : signed(delta)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">
                    {d.stopReason ? `${d.stopReason} · after #${d.stopAfter}` : 'Plan never stopped the day'}
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${key}-detail`} className="border-b border-gray-700/30 bg-gray-900/40">
                    <td colSpan={7} className="px-6 py-3">
                      <div className="space-y-1">
                        {d.trades.map((r, i) => (
                          <div key={r.trade.id ?? i} className={cn('flex items-center gap-3 text-xs', !r.taken && 'opacity-50')}>
                            <span className="w-6 text-gray-500 tabular-nums">#{i + 1}</span>
                            <span className="w-12 text-gray-400 tabular-nums">{ctTimeLabel(r.trade.entry_time) ?? '—'}</span>
                            <span className="w-20 text-gray-300">{r.trade.instrument || 'ES'} ×{r.trade.quantity}</span>
                            <span className={cn('w-20 text-right tabular-nums', r.trade.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {signed(r.trade.net_pnl)}
                            </span>
                            <span className={cn('w-16', r.taken ? 'text-gray-500' : 'text-gray-500 line-through')}>
                              {r.taken ? 'taken' : 'skipped'}
                            </span>
                            {d.stopAfter === i + 1 && <span className="text-blue-300">← {d.stopReason}</span>}
                            {r.flags.length > 0 && <span className="text-amber-300/90">{r.flags.join(' · ')}</span>}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-600">
        Small samples swing hard — a few days say little about the plan. Let the totals build before changing a rule.
      </p>
    </div>
  )
}
