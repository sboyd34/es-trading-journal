'use client'

import { useState, useMemo } from 'react'
import { Trade } from '@/types'
import { formatCurrency, cn } from '@/lib/utils'
import { APEX_CONFIGS, ACCOUNT_SIZES, type AccountSize } from '@/lib/apex-config'
import {
  computeUncertainty,
  assessAdequacy,
  BOOTSTRAP_REPS,
  BOOTSTRAP_INNER_SIMS,
  type Adequacy,
} from '@/lib/eval-uncertainty'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Legend,
  LineChart,
  Line,
} from 'recharts'
import { Shuffle } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  trades: Trade[]
  // riskRules was dropped here: its only consumer was the old ruin-threshold
  // default (riskRules.max_daily_loss), which was the unit mismatch this change
  // fixes. The threshold now comes from APEX_CONFIGS. riskRules is still used
  // elsewhere on the reports page -- only this prop went away.
}

const tooltipStyle = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#f3f4f6',
  },
}

interface MonteCarloResult {
  fanData: Array<{ trade: number; p5: number; p25: number; p50: number; p75: number; p95: number }>
  histogram: Array<{ bin: string; count: number; positive: boolean }>
  maxDDHistogram: Array<{ midpoint: number; count: number; aboveThreshold: boolean }>
  probProfit: number
  /**
   * Profitable AND never ruined. The honest headline: `probProfit` counts paths
   * that blew through the threshold and recovered, which a real account cannot
   * do. See the non-termination note in the sim loop.
   */
  probProfitSurvived: number
  /** 95% interval on probProfitSurvived, percentage points. */
  survivedCI: [number, number]
  /** Error from simulation count — fixable by running more sims. */
  mcStdErr: number
  /** Error from sample size — NOT fixable by more sims, only more trades. */
  estimationStdErr: number
  adequacy: Adequacy
  median: number
  p5: number
  p95: number
  expectedValue: number
  ruinProb: number
}

export default function MonteCarloTab({ trades }: Props) {
  const [mcNumTrades, setMcNumTrades] = useState(50)
  const [mcRunCount, setMcRunCount] = useState(0)

  // The threshold now defaults to the Apex TRAILING DRAWDOWN, not
  // riskRules.max_daily_loss.
  //
  // The old default was a unit mismatch: a per-DAY loss limit compared against
  // a 50-trade CUMULATIVE total. On a $150 daily limit that made "ruin" mean
  // "your running total dipped $150 underwater at some point", which a single
  // bad trade achieves — it reported 53% ruin on a positive-expectancy system
  // while the real figure at the account's actual buffer is under 1%.
  //
  // apex-config is the single source of truth for account sizing (see
  // CLAUDE.md), so the figure comes from there rather than being retyped.
  // NOTE a known conflict: ATRRiskSizer treats the 50K buffer as the LEGACY
  // $2,500 while APEX_CONFIGS[50000].trailingDrawdown is $2,000 (the 4.0 EOD
  // rule). This follows apex-config; override in the input if your agreement
  // says otherwise.
  const [mcAccountSize, setMcAccountSize] = useState<AccountSize>(50000)
  // Explicitly <number>. APEX_CONFIGS is `as const`, so .trailingDrawdown has
  // the LITERAL type 2000 -- without the annotation useState infers the state
  // as `2000` and every other account size fails to assign.
  const [mcRuinThreshold, setMcRuinThreshold] = useState<number>(
    () => APEX_CONFIGS[50000].trailingDrawdown,
  )

  // Selecting a size WRITES the threshold rather than deriving it, so the two
  // cannot drift out of sync and a manual override is never silently clobbered.
  const applyAccountSize = (size: AccountSize) => {
    setMcAccountSize(size)
    setMcRuinThreshold(APEX_CONFIGS[size].trailingDrawdown)
  }

  const monteCarloResult = useMemo((): MonteCarloResult | null => {
    if (trades.length < 5 || mcRunCount === 0) return null
    const NUM_SIMS = 1000
    const N = Math.min(Math.max(mcNumTrades, 10), 200)

    const stepValues: number[][] = Array.from({ length: N + 1 }, () => [])
    const maxDDs: number[] = []
    let ruinedCount = 0
    let survivedProfitCount = 0

    for (let sim = 0; sim < NUM_SIMS; sim++) {
      let cum = 0
      let peak = 0
      let maxDD = 0
      let ruined = false
      stepValues[0].push(0)
      for (let t = 0; t < N; t++) {
        cum += trades[Math.floor(Math.random() * trades.length)].net_pnl
        if (cum > peak) peak = cum
        const dd = peak - cum
        if (dd > maxDD) maxDD = dd

        // RUIN = PEAK-TO-TROUGH, not absolute loss. Apex closes the account on
        // trailing drawdown from the high-water mark, so a path that runs +$2k
        // then gives back the buffer is dead even though `cum` is still
        // positive. The old test (`cum <= -threshold`) could not see that case
        // at all. The maxDD this uses was already being computed and charted
        // below -- it just was not what the ruin verdict keyed off.
        if (dd >= mcRuinThreshold) ruined = true

        stepValues[t + 1].push(cum)
      }
      maxDDs.push(maxDD)
      if (ruined) ruinedCount++

      // NON-TERMINATION, deliberate and worth understanding: a ruined path
      // KEEPS TRADING to N. That is why probProfit and ruinProb can both be
      // high and sum past 100% -- they describe the same paths under
      // incompatible assumptions. Terminating on ruin would change the meaning
      // of the fan, histogram and expected value, so instead this counts the
      // intersection, which is the figure that survives contact with a real
      // account.
      if (cum > 0 && !ruined) survivedProfitCount++
    }

    // ===================== ADEQUACY (ported from the eval MC) =====================
    // Both helpers come from lib/eval-uncertainty, not a local copy. They are
    // metric-agnostic -- computeUncertainty takes any array of proportions and
    // assessAdequacy takes a CI width -- so nothing needed adapting. Reusing
    // them is the same single-source discipline as apex-config above; the
    // alternative is the inline-copy drift that silently broke the patterns
    // route's rules for weeks.
    //
    // The metric under test is probProfitSurvived, not probProfit. There is no
    // point putting an error bar on a number that already assumes the account
    // cannot die.
    //
    // NESTED BOOTSTRAP: resample the TRADE POOL (outer), then run paths on each
    // resampled pool (inner). The outer spread is what sample size buys you;
    // the inner spread is ordinary simulation noise, which computeUncertainty
    // subtracts off so estimationStdErr isolates the part more simulations
    // cannot fix.
    const runPaths = (pool: number[], sims: number): number => {
      let surv = 0
      for (let s = 0; s < sims; s++) {
        let c = 0
        let pk = 0
        let r = false
        for (let i = 0; i < N; i++) {
          c += pool[Math.floor(Math.random() * pool.length)]
          if (c > pk) pk = c
          if (pk - c >= mcRuinThreshold) r = true
        }
        if (c > 0 && !r) surv++
      }
      return surv / sims
    }

    const pnls = trades.map((t) => t.net_pnl)

    // A bootstrap failure must not fail the simulation. A broken error bar is
    // not a reason to withhold the run -- it is a reason to refuse to render a
    // precise number, which assessAdequacy handles via bootstrapReps === 0.
    let bootstrapProps: number[] = []
    try {
      for (let rep = 0; rep < BOOTSTRAP_REPS; rep++) {
        const resampled = Array.from(
          { length: pnls.length },
          () => pnls[Math.floor(Math.random() * pnls.length)],
        )
        bootstrapProps.push(runPaths(resampled, BOOTSTRAP_INNER_SIMS))
      }
    } catch {
      bootstrapProps = []
    }

    const uncertainty = computeUncertainty({
      bootstrapProps,
      innerSims: BOOTSTRAP_INNER_SIMS,
      pointEstimate: survivedProfitCount / NUM_SIMS,
      numSimulations: NUM_SIMS,
    })

    // distinctDays uses `date` with an entry_time fallback, because a sample
    // spanning few days is one regime however many trades it holds.
    const distinctDays = new Set(
      trades.map((t) => t.date ?? String(t.entry_time ?? '').slice(0, 10)),
    ).size

    // MFE coverage matters HERE too, for a reason specific to this tab: ruin is
    // measured on the trade-close-to-trade-close equity curve, so an intra-trade
    // excursion that ran +3R and gave it back is invisible. Without MFE the
    // drawdown -- and therefore the ruin probability -- is understated.
    const excursionsPresent = trades.filter((t) => t.mfe != null).length

    const adequacy = assessAdequacy({
      ciWidth: uncertainty.ciWidth,
      tradeCount: trades.length,
      distinctDays,
      excursionsPresent,
      bootstrapReps: bootstrapProps.length,
    })

    const pct = (arr: number[], p: number) => arr[Math.floor(arr.length * p)] ?? 0

    const stride = Math.max(1, Math.floor(N / 50))
    const steps: number[] = []
    for (let i = 0; i <= N; i += stride) steps.push(i)
    if (steps[steps.length - 1] !== N) steps.push(N)

    const fanData = steps.map((step) => {
      const sorted = [...stepValues[step]].sort((a, b) => a - b)
      return {
        trade: step,
        p5: pct(sorted, 0.05),
        p25: pct(sorted, 0.25),
        p50: pct(sorted, 0.5),
        p75: pct(sorted, 0.75),
        p95: pct(sorted, 0.95),
      }
    })

    const finals = stepValues[N]
    const sortedFinals = [...finals].sort((a, b) => a - b)
    const fMin = sortedFinals[0]
    const fMax = sortedFinals[sortedFinals.length - 1]
    const BIN_COUNT = 25
    const fBinWidth = (fMax - fMin) / BIN_COUNT || 1
    const histogram = Array.from({ length: BIN_COUNT }, (_, i) => {
      const lo = fMin + i * fBinWidth
      const hi = lo + fBinWidth
      const count = finals.filter((v) =>
        i === BIN_COUNT - 1 ? v >= lo && v <= hi : v >= lo && v < hi,
      ).length
      return { bin: `$${Math.round(lo + fBinWidth / 2)}`, count, positive: lo + fBinWidth / 2 >= 0 }
    })

    const sortedDDs = [...maxDDs].sort((a, b) => a - b)
    const ddMin = sortedDDs[0]
    const ddMax = sortedDDs[sortedDDs.length - 1]
    const ddBinWidth = (ddMax - ddMin) / BIN_COUNT || 1
    const maxDDHistogram = Array.from({ length: BIN_COUNT }, (_, i) => {
      const lo = ddMin + i * ddBinWidth
      const hi = lo + ddBinWidth
      const midpoint = lo + ddBinWidth / 2
      const count = maxDDs.filter((v) =>
        i === BIN_COUNT - 1 ? v >= lo && v <= hi : v >= lo && v < hi,
      ).length
      return { midpoint, count, aboveThreshold: midpoint > mcRuinThreshold }
    })

    return {
      fanData,
      histogram,
      maxDDHistogram,
      probProfit: (finals.filter((v) => v > 0).length / finals.length) * 100,
      probProfitSurvived: (survivedProfitCount / NUM_SIMS) * 100,
      survivedCI: uncertainty.passProbCI,
      mcStdErr: uncertainty.mcStdErr,
      estimationStdErr: uncertainty.estimationStdErr,
      adequacy,
      median: pct(sortedFinals, 0.5),
      p5: pct(sortedFinals, 0.05),
      p95: pct(sortedFinals, 0.95),
      expectedValue: finals.reduce((s, v) => s + v, 0) / finals.length,
      ruinProb: (ruinedCount / NUM_SIMS) * 100,
    }
  }, [trades, mcNumTrades, mcRunCount, mcRuinThreshold])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-white">Monte Carlo Simulator</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            1,000 random trade sequences sampled from your history to forecast P&L distribution.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">Trades per path:</label>
            <input
              type="number"
              min={10}
              max={200}
              step={10}
              value={mcNumTrades}
              onChange={(e) => setMcNumTrades(parseInt(e.target.value) || 50)}
              className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">Account:</label>
            <select
              value={mcAccountSize}
              onChange={(e) => applyAccountSize(Number(e.target.value) as AccountSize)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            >
              {ACCOUNT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size / 1000}K (DD ${APEX_CONFIGS[size].trailingDrawdown.toLocaleString()})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">
              Trailing DD ($):
            </label>
            <input
              type="number"
              min={100}
              step={100}
              value={mcRuinThreshold}
              onChange={(e) =>
                setMcRuinThreshold(
                  parseInt(e.target.value) || APEX_CONFIGS[mcAccountSize].trailingDrawdown,
                )
              }
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-red-500"
            />
          </div>
          <button
            onClick={() => {
              if (trades.length < 5) {
                toast.error('Need at least 5 trades to run simulation')
                return
              }
              setMcRunCount((c) => c + 1)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold rounded-xl transition"
          >
            <Shuffle className="h-4 w-4" />
            {mcRunCount === 0 ? 'Run Simulation' : 'Re-Run'}
          </button>
        </div>
      </div>

      {mcRunCount === 0 ? (
        <div className="bg-gray-800/30 border border-gray-700/50 border-dashed rounded-xl p-12 text-center">
          <Shuffle className="h-12 w-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 font-medium">No simulation run yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Click &ldquo;Run Simulation&rdquo; to generate 1,000 random trade sequences based on your history.
          </p>
          <p className="text-gray-700 text-xs mt-2">Requires at least 5 trades.</p>
        </div>
      ) : monteCarloResult ? (
        <div className="space-y-6">
          {/*
            ADEQUACY BANNER. The gate is SELF-CALIBRATING: it keys off the CI
            width the data actually produced, not a trade-count rule of thumb.
            A thin sample does not get a quiet caveat -- an 'insufficient'
            verdict replaces the precise percentages with their interval, on
            the principle that a number nobody should act on is worse than a
            range that is honest about itself.
          */}
          <div
            className={cn(
              'rounded-xl border p-4',
              monteCarloResult.adequacy.verdict === 'adequate'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : monteCarloResult.adequacy.verdict === 'directional'
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-red-500/10 border-red-500/30',
            )}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  'text-xs font-bold uppercase tracking-wide',
                  monteCarloResult.adequacy.verdict === 'adequate'
                    ? 'text-emerald-400'
                    : monteCarloResult.adequacy.verdict === 'directional'
                      ? 'text-amber-400'
                      : 'text-red-400',
                )}
              >
                {monteCarloResult.adequacy.verdict}
              </span>
              <span className="text-xs text-gray-400">
                {monteCarloResult.adequacy.tradeCount} trades ·{' '}
                {monteCarloResult.adequacy.distinctDays} distinct days · MFE on{' '}
                {(monteCarloResult.adequacy.excursionCoverage * 100).toFixed(0)}% · CI width{' '}
                {monteCarloResult.adequacy.ciWidth.toFixed(1)} pts
              </span>
            </div>

            {/*
              The decomposition is the actionable part: if sim error dominates,
              re-run with more paths. If estimation error dominates, no amount
              of compute helps and the only lever is more trades.
            */}
            <p className="text-xs text-gray-400 mt-2">
              Error from simulation count:{' '}
              <span className="text-gray-200 font-semibold">
                ±{monteCarloResult.mcStdErr.toFixed(1)} pts
              </span>{' '}
              (fixable — run more paths) · Error from sample size:{' '}
              <span className="text-gray-200 font-semibold">
                ±{monteCarloResult.estimationStdErr.toFixed(1)} pts
              </span>{' '}
              (only more trades fix this)
            </p>

            {monteCarloResult.adequacy.blockers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {monteCarloResult.adequacy.blockers.map((b) => (
                  <li key={b} className="text-xs text-gray-300">
                    • {b}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/*
            4 columns, not 6. Adding the "Profit & Survived" tile took the count
            from 6 to 7, which orphaned one tile onto its own row at lg. 4+3 is
            balanced, and it gives the longer labels room instead of squeezing
            seven narrow columns.
          */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[
              {
                // On an 'insufficient' verdict this renders the INTERVAL
                // instead of the point estimate. A single figure invites a
                // sizing decision the sample cannot support; a range carries
                // its own uncertainty with it and cannot be misread as precise.
                label:
                  monteCarloResult.adequacy.verdict === 'insufficient'
                    ? 'Profit & Survived (range)'
                    : 'Profit & Survived',
                value:
                  monteCarloResult.adequacy.verdict === 'insufficient'
                    ? `${monteCarloResult.survivedCI[0].toFixed(0)}–${monteCarloResult.survivedCI[1].toFixed(0)}%`
                    : `${monteCarloResult.probProfitSurvived.toFixed(1)}%`,
                color:
                  monteCarloResult.adequacy.verdict === 'insufficient'
                    ? 'text-amber-400'
                    : monteCarloResult.probProfitSurvived >= 50
                      ? 'text-emerald-400'
                      : 'text-red-400',
              },
              {
                // Deliberately second, and deliberately labelled "ignoring
                // ruin": this counts paths that breached the trailing drawdown
                // and traded on, which a closed account cannot. Kept because
                // the gap between it and the tile above IS the information --
                // a wide gap means the edge is real but the risk kills it.
                label: 'Prob. of Profit (ignoring ruin)',
                value: `${monteCarloResult.probProfit.toFixed(1)}%`,
                color: 'text-gray-400',
              },
              {
                label: 'Median Outcome',
                value: formatCurrency(monteCarloResult.median),
                color: monteCarloResult.median >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: '5th Pct (Worst 5%)',
                value: formatCurrency(monteCarloResult.p5),
                color: 'text-red-400',
              },
              {
                label: '95th Pct (Best 5%)',
                value: formatCurrency(monteCarloResult.p95),
                color: 'text-emerald-400',
              },
              {
                label: 'Expected Value',
                value: formatCurrency(monteCarloResult.expectedValue),
                color: monteCarloResult.expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
              {
                label: 'Ruin Probability',
                value: `${monteCarloResult.ruinProb.toFixed(1)}%`,
                color:
                  monteCarloResult.ruinProb > 10
                    ? 'text-red-400'
                    : monteCarloResult.ruinProb > 5
                      ? 'text-amber-400'
                      : 'text-emerald-400',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4"
              >
                <p className="text-xs text-gray-400 font-medium">{stat.label}</p>
                <p className={cn('text-xl font-bold mt-1', stat.color)}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-300 mb-4">
              Equity Path Percentiles — {mcNumTrades} trades
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={monteCarloResult.fanData}
                margin={{ top: 5, right: 10, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="trade"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  label={{
                    value: 'Trade #',
                    position: 'insideBottom',
                    offset: -10,
                    fill: '#6b7280',
                    fontSize: 11,
                  }}
                />
                <YAxis
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 2" />
                <Tooltip
                  {...tooltipStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any, name: any) => [formatCurrency(Number(v)), name]}
                />
                <Line dataKey="p95" name="95th %" stroke="#10b981" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                <Line dataKey="p75" name="75th %" stroke="#60a5fa" strokeWidth={1} strokeDasharray="3 2" dot={false} />
                <Line dataKey="p50" name="Median" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                <Line dataKey="p25" name="25th %" stroke="#60a5fa" strokeWidth={1} strokeDasharray="3 2" dot={false} />
                <Line dataKey="p5" name="5th %" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-300 mb-4">
              Final P&L Distribution after {mcNumTrades} trades
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={monteCarloResult.histogram}
                margin={{ top: 5, right: 10, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="bin"
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  interval={4}
                  angle={-30}
                  textAnchor="end"
                />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip
                  {...tooltipStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [v, 'Simulations']}
                />
                <Bar dataKey="count" name="Simulations">
                  {monteCarloResult.histogram.map((entry, index) => (
                    <Cell key={index} fill={entry.positive ? '#10b981' : '#ef4444'} opacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-600 mt-3 text-center">
              Based on 1,000 simulations sampling randomly (with replacement) from your{' '}
              {trades.length} historical trades.
            </p>
          </div>

          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
            <p className="text-sm font-semibold text-gray-300 mb-4">
              Max Drawdown Distribution — {mcNumTrades} trades
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={monteCarloResult.maxDDHistogram}
                margin={{ top: 5, right: 10, left: 10, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="midpoint"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`
                  }
                  tick={{ fontSize: 9, fill: '#9ca3af' }}
                  tickCount={8}
                />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <ReferenceLine
                  x={mcRuinThreshold}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  label={{ value: 'Ruin', position: 'top', fill: '#ef4444', fontSize: 10 }}
                />
                <Tooltip
                  {...tooltipStyle}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [v, 'Simulations']}
                  labelFormatter={(v) =>
                    `Max DD: ${Number(v) >= 1000 ? `$${(Number(v) / 1000).toFixed(1)}k` : `$${Math.round(Number(v))}`}`
                  }
                />
                <Bar dataKey="count" name="Simulations">
                  {monteCarloResult.maxDDHistogram.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={entry.aboveThreshold ? '#ef4444' : '#6b7280'}
                      opacity={0.75}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-600 mt-3 text-center">
              Peak-to-trough drawdown across 1,000 paths. Red line = your ruin threshold.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
