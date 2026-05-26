'use client'

import { AlertTriangle } from 'lucide-react'

/**
 * Static reference card for the MES bracket-order configuration.
 * Source: Trading_Journal_ES_MES.docx §1.2 (verbatim).
 *
 * Spec: docs/superpowers/specs/2026-05-26-bracket-spec-card-design.md
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

const BRACKET_SPECS_25K: BracketSpec = {
  accountSize: '25K',
  totalContracts: '2 MES total',
  legs: [
    { name: 'Leg 1', contracts: '1 MES', tp: '+8 ticks', sl: '−8 ticks', risk: '$10', win: '$10' },
    { name: 'Leg 2 (runner)', contracts: '1 MES', tp: '+16 ticks', sl: '−8 ticks → BE on TP1', risk: '$10', win: '$20' },
  ],
  totalRisk: '$20 max',
  totalWin: '$30 max',
}

const BRACKET_SPECS_50K: BracketSpec = {
  accountSize: '50K',
  totalContracts: '4 MES total',
  legs: [
    { name: 'Leg 1', contracts: '2 MES', tp: '+8 ticks', sl: '−8 ticks', risk: '$20', win: '$20' },
    { name: 'Leg 2 (runner)', contracts: '2 MES', tp: '+16 ticks', sl: '−8 ticks → BE on TP1', risk: '$20', win: '$40' },
  ],
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
          <span className="font-semibold">ES is OFF-LIMITS</span> at both
          account sizes. Tick size ($12.50) makes a proper 8-tick stop ={' '}
          <span className="font-mono">$100/contract</span> — 5× per-trade risk
          on 25K, 2.5× on 50K. Switch to ES only after a funded account has
          built a <span className="font-mono">$750+</span> buffer above the
          locked drawdown.
        </p>
      </div>
    </section>
  )
}
