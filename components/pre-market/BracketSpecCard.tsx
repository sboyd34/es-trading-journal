'use client'

import { AlertTriangle } from 'lucide-react'

/**
 * Static reference card for the MES bracket-order configuration.
 * MES: the trader's 2-contract bracket (MES_BRACKET in lib/apex-config) — risk
 * deliberately below the plan's per-trade band. ES: ES_BRACKET, 8/12 ticks.
 *
 * Original spec: docs/superpowers/specs/2026-05-26-bracket-spec-card-design.md
 *
 * Hardcoded constants — discipline parameters should change via code
 * review, not a settings UI (same principle as THE_15_RULES in
 * lib/preopen-ritual.ts).
 */

interface BracketLeg {
  name: string
  contracts: string
  tp: string
  sl: string
  risk: string
  win: string
}

interface BracketSpec {
  accountSize: '25K' | '50K'
  totalContracts: string
  legs: BracketLeg[]
  totalRisk: string
  totalWin: string
}

// MES_BRACKET (lib/apex-config), the same on both accounts: 2 MES, each behind
// a 16-tick stop ($20 each, $40 total); leg 1 +16 ticks ($20), leg 2 +32 ticks
// ($40) — $60 if both fill. Leg 2's stop moves to breakeven when leg 1 fills.
const MES_LEGS: BracketLeg[] = [
  { name: 'Leg 1', contracts: '1 MES', tp: '+16 ticks', sl: '−16 ticks', risk: '$20', win: '$20' },
  { name: 'Leg 2', contracts: '1 MES', tp: '+32 ticks', sl: '−16 ticks → BE on TP1', risk: '$20', win: '$40' },
]

const BRACKET_SPECS_25K: BracketSpec = {
  accountSize: '25K',
  totalContracts: '2 MES total',
  legs: MES_LEGS,
  totalRisk: '$40 max',
  totalWin: '$60 max',
}

const BRACKET_SPECS_50K: BracketSpec = {
  accountSize: '50K',
  totalContracts: '2 MES total',
  legs: MES_LEGS,
  totalRisk: '$40 max',
  totalWin: '$60 max',
}

function BracketTable({ spec }: { spec: BracketSpec }) {
  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-100">
          {spec.accountSize} accounts
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">{spec.totalContracts}</p>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-700/50 text-gray-400">
            <th className="text-left py-1.5 font-medium">Leg</th>
            <th className="text-left py-1.5 font-medium">Qty</th>
            <th className="text-left py-1.5 font-medium">TP</th>
            <th className="text-left py-1.5 font-medium">SL</th>
            <th className="text-right py-1.5 font-medium">$ Risk</th>
            <th className="text-right py-1.5 font-medium">$ Win</th>
          </tr>
        </thead>
        <tbody className="text-gray-200">
          {spec.legs.map((leg) => (
            <tr key={leg.name} className="border-b border-gray-700/30">
              <td className="py-1.5">{leg.name}</td>
              <td className="py-1.5">{leg.contracts}</td>
              <td className="py-1.5 font-mono">{leg.tp}</td>
              <td className="py-1.5 font-mono">{leg.sl}</td>
              <td className="py-1.5 text-right font-mono">{leg.risk}</td>
              <td className="py-1.5 text-right font-mono">{leg.win}</td>
            </tr>
          ))}
          <tr className="text-gray-100 font-semibold">
            <td className="py-2">TOTAL</td>
            <td className="py-2">{spec.totalContracts.replace(' total', '')}</td>
            <td className="py-2">—</td>
            <td className="py-2">—</td>
            <td className="py-2 text-right font-mono text-red-300">{spec.totalRisk}</td>
            <td className="py-2 text-right font-mono text-emerald-300">{spec.totalWin}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function BracketSpecCard() {
  return (
    <section className="rounded-xl border border-gray-700/50 bg-gray-800/30 p-6 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-100">
          Bracket Order Specs (MES only)
        </h2>
        <p className="text-sm italic text-gray-400 mt-1">
          Saved as ATM templates so you never type ticks during a live setup.
        </p>
      </div>

      {/* Two tables — side-by-side on desktop, stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BracketTable spec={BRACKET_SPECS_25K} />
        <BracketTable spec={BRACKET_SPECS_50K} />
      </div>

      {/* ES warning callout */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-200 leading-relaxed">
          <span className="font-semibold">ES only where the plan allows it.</span>{' '}
          An 8-tick ES stop is <span className="font-mono">$100/contract</span>.
          On the 50K that fits the $100–$125 band — 1 ES, −8t stop ($100),
          +12t target ($150), ATR under 6. On the 25K it is over the $75
          max, so ES waits until the PA trail locks with{' '}
          <span className="font-mono">$1,500+</span> above it. No runners: the
          trail counts open profit.
        </p>
      </div>
    </section>
  )
}
