'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn, formatCurrency } from '@/lib/utils'
import { ctTimeLabel } from '@/lib/trade-flags'
import { replayPlan } from '@/lib/plan-replay'
import { bracketWhatIf } from '@/lib/bracket-whatif'
import { ES_BRACKET } from '@/lib/apex-config'
import { feeForContracts } from '@/lib/tradovate-parser'
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

const BRACKET_PRESETS: [number, number][] = [[8, 8], [8, 12], [8, 16], [6, 12]]
const ES_FEE = feeForContracts('ES', 1)

// Every trade replayed as 1 ES under a fixed stop/target (lib/bracket-whatif).
// Shows a range, because the journal only partly knows each trade's path.
function BracketWhatIfCard({ trades }: { trades: Trade[] }) {
  // Opens on the plan's /ES bracket.
  const [stopTicks, setStopTicks] = useState<number>(ES_BRACKET.stopTicks)
  const [targetTicks, setTargetTicks] = useState<number>(ES_BRACKET.targetTicks)
  const clampTicks = (v: number) => Math.min(Math.max(Math.round(v) || 1, 1), 80)

  const w = useMemo(() => bracketWhatIf(trades, stopTicks, targetTicks, { fee: ES_FEE }), [trades, stopTicks, targetTicks])
  const actualAt1 = useMemo(
    () => trades.reduce((s, t) => s + (t.direction === 'long' ? 1 : -1) * (t.exit_price - t.entry_price) * 50 - ES_FEE, 0),
    [trades],
  )
  const unknown = w.orderUnknown + w.exitedEarly

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">Bracket what-if — every trade as 1 ES</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Win {signed(w.winPnl)} · loss {signed(w.lossPnl)} (incl. ${ES_FEE.toFixed(2)} fee) · break-even win rate {w.breakevenRate.toFixed(1)}%
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {BRACKET_PRESETS.map(([s, t]) => (
            <button key={`${s}/${t}`} onClick={() => { setStopTicks(s); setTargetTicks(t) }}
              className={cn('px-2.5 py-1 rounded-md text-xs font-medium border transition',
                s === stopTicks && t === targetTicks
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-900/60 border-gray-700 text-gray-400 hover:text-white')}>
              {s}/{t}
            </button>
          ))}
          <label className="text-xs text-gray-500 flex items-center gap-1">
            stop
            <input type="number" min={1} max={80} value={stopTicks}
              onChange={(e) => setStopTicks(clampTicks(Number(e.target.value)))}
              className="w-14 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200" />
          </label>
          <label className="text-xs text-gray-500 flex items-center gap-1">
            target
            <input type="number" min={1} max={80} value={targetTicks}
              onChange={(e) => setTargetTicks(clampTicks(Number(e.target.value)))}
              className="w-14 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200" />
          </label>
          <span className="text-xs text-gray-600">ticks</span>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
        {[
          ['Definite win', w.definiteWin, 'text-emerald-400'],
          ['Definite loss', w.definiteLoss, 'text-red-400'],
          ['Likely win', w.likelyWin, 'text-emerald-300/80'],
          ['Likely loss', w.likelyLoss, 'text-red-300/80'],
          ['Order unknown', w.orderUnknown, 'text-gray-400'],
          ['Exited early', w.exitedEarly, 'text-gray-400'],
        ].map(([label, n, cls]) => (
          <div key={label as string} className="bg-gray-900/40 rounded-lg py-2">
            <p className={cn('text-lg font-bold tabular-nums', cls as string)}>{n as number}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label as string}</p>
          </div>
        ))}
      </div>

      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-gray-700/30">
            <td className="py-2 text-gray-400">Known outcomes ({w.resolved} trades)</td>
            <td className="py-2 text-right text-gray-400 tabular-nums">
              {w.winRate === null ? '—' : `${w.wins}W / ${w.losses}L · ${w.winRate.toFixed(1)}%`}
            </td>
            <td className={cn('py-2 text-right font-semibold tabular-nums w-28', w.resolvedNet >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {signed(w.resolvedNet)}
            </td>
          </tr>
          <tr className="border-b border-gray-700/30">
            <td className="py-2 text-gray-300">All {w.total}, unknowns at that win rate</td>
            <td className="py-2 text-right text-gray-500 tabular-nums">
              {w.expectancy === null ? '' : `${signed(w.expectancy)}/trade`}
            </td>
            <td className={cn('py-2 text-right font-bold tabular-nums', (w.estimateAll ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {w.estimateAll === null ? '—' : signed(w.estimateAll)}
            </td>
          </tr>
          <tr className="border-b border-gray-700/30">
            <td className="py-2 text-gray-400">Range: all {unknown} unknowns lost … all won</td>
            <td />
            <td className="py-2 text-right text-gray-400 tabular-nums whitespace-nowrap">{signed(w.worstAll)} … {signed(w.bestAll)}</td>
          </tr>
          <tr>
            <td className="py-2 text-gray-500">For comparison: 1 ES each, your actual exits</td>
            <td />
            <td className={cn('py-2 text-right tabular-nums', actualAt1 >= 0 ? 'text-emerald-400/80' : 'text-red-400/80')}>{signed(actualAt1)}</td>
          </tr>
        </tbody>
      </table>

      <p className="text-[11px] text-gray-500 leading-relaxed">
        A loss is proven by any close past the stop; a win only by MFE or a close at the full target — so known outcomes
        lean toward losses, more as the target widens. {w.exitedEarly} trades closed before reaching either level; log MFE/MAE
        on every trade to turn the range into one answer.
        {w.typoFixes > 0 && ` ${w.typoFixes} hand-entered MFE/MAE values were smaller than the trade's own exit and were raised to it.`}
      </p>
    </div>
  )
}

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
          Your real trades, re-run under the plan&apos;s daily rules — hard daily stop, loser limit, profit
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

      <BracketWhatIfCard trades={trades} />

      <p className="text-[11px] text-gray-600">
        Small samples swing hard — a few days say little about the plan. Let the totals build before changing a rule.
      </p>
    </div>
  )
}
