import { ScrollText, AlertTriangle, Lightbulb, ShieldCheck } from 'lucide-react'

// Static reference page — the Apex Trader Funding Unified Trading Framework.
// Single source of truth for 25K and 50K account rules (Eval & PA identical).

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function KVTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
            <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{k}</td>
            <td className="py-2 text-right font-medium text-gray-900 dark:text-white tabular-nums">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Callout({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof AlertTriangle
  tone: 'warn' | 'tip'
  children: React.ReactNode
}) {
  const styles =
    tone === 'warn'
      ? 'border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300'
      : 'border-blue-300 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-500/10 text-blue-800 dark:text-blue-300'
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

function BracketTable({
  rows,
  cols,
}: {
  cols: string[]
  rows: { label: string; values: string[]; muted?: boolean }[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400"></th>
            {cols.map((c) => (
              <th key={c} className="py-2 px-3 text-right font-medium text-gray-500 dark:text-gray-400">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
              <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">{r.label}</td>
              {r.values.map((v, j) => (
                <td
                  key={j}
                  className={`py-2 px-3 text-right tabular-nums ${
                    r.muted ? 'text-gray-400 dark:text-gray-500' : 'font-medium text-gray-900 dark:text-white'
                  }`}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KillSwitch({ rules }: { rules: string[] }) {
  return (
    <ul className="space-y-2">
      {rules.map((rule, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-500" />
          <span>{rule}</span>
        </li>
      ))}
    </ul>
  )
}

const SESSION_ROWS: [string, string][] = [
  ['Overnight / Globex (6:00 PM – 9:30 AM CT)', '3 trades'],
  ['Regular Trading Hours (9:30 AM – 4:00 PM CT)', '3 trades'],
  ['Daily Hard Ceiling (both sessions)', '5 trades'],
]

const KILL_SWITCH_BASE = (target: string, loss: string) => [
  `Hit ${target} profit → stop trading, day is done`,
  `Hit ${loss} loss → stop trading, day is done`,
  '3 consecutive losses → stop trading, day is done',
  '5 trades completed → stop trading, day is done',
  '10-minute mandatory cooldown after every loss',
  'No trades during FOMC, CPI, NFP or any major scheduled news events',
  'Never widen a stop loss — ever',
  'Never add to a losing position',
  'Avoid midday chop (12:00 PM – 2:00 PM CT) unless setup is crystal clear',
  '/ES requires all 3 conditions met simultaneously — missing any one = /MES only',
]

export default function FrameworkPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-yellow-500/10 p-2.5">
          <ScrollText className="h-6 w-6 text-yellow-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Trading Framework</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Apex Trader Funding — Unified Rules · ES / MES · Eval &amp; PA identical
          </p>
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
        The single source of truth for all trading rules across both the 25K and 50K Apex accounts. Rules apply
        identically to Evaluation and Performance Accounts. Print, laminate, and keep at your station.
      </p>

      {/* ── SECTION 1: 25K ── */}
      <div className="pt-2">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Section 1 — 25K Account</h2>
        <div className="h-0.5 w-12 bg-yellow-500 rounded-full mb-4" />
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="Account Parameters">
            <KVTable
              rows={[
                ['Account Size', '$25,000'],
                ['Trailing Drawdown Limit', '$500'],
                ['Eval Profit Target', '$1,500'],
                ['PA Safety Net (min balance floor)', '$26,100'],
                ['PA Min Balance to Request Payout', '$26,600'],
                ['PA Profit Needed Before First Payout', '$1,600'],
                ['PA Qualifying Days', '5 days @ $100 min (non-consecutive ok)'],
                ['50% Consistency Rule', 'No single day ≥ 50% of total profit'],
                ['Max Payouts Per PA', '6'],
                ['Min Payout Amount', '$500'],
                ['Max Payout Per Request', '$1,000'],
              ]}
            />
          </SectionCard>

          <div className="space-y-4">
            <SectionCard title="Position Structure">
              <KVTable
                rows={[
                  ['Default (always)', '/MES — 2 contracts'],
                  ['All 3 ES conditions met', '/ES — 1 contract'],
                ]}
              />
              <div className="mt-4">
                <Callout icon={AlertTriangle} tone="warn">
                  Never trade /MES and /ES simultaneously. You are always in ONE bracket at a time.
                </Callout>
              </div>
            </SectionCard>

            <SectionCard title="/ES Authorization — All 3 Conditions Required">
              <KVTable
                rows={[
                  ['Account Status', 'PA only — NEVER during Eval'],
                  ['Buffer Above Drawdown', '$1,500+ above locked drawdown'],
                  ['ATR at Entry', 'Under 6 — else /ES off the table'],
                ]}
              />
            </SectionCard>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mt-4">
          <SectionCard title="Bracket Order Specifications">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">/MES</p>
            <BracketTable
              cols={['Leg 1', 'Leg 2', 'Total']}
              rows={[
                { label: 'Contracts', values: ['1 MES', '1 MES', '2 MES'] },
                { label: 'Profit Target', values: ['+8t ($10)', '+16t ($20)', '$30 max'] },
                { label: 'Stop Loss', values: ['-8t (-$10)', '-8t (-$10)', '-$20 max'] },
                { label: 'Breakeven', values: ['—', 'Move to BE when Leg 1 fills', ''], muted: true },
              ]}
            />
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-4 mb-2">/ES (if authorized)</p>
            <BracketTable
              cols={['Leg 1', 'Leg 2', 'Total']}
              rows={[
                { label: 'Contracts', values: ['1 ES', '1 ES', '1 ES'] },
                { label: 'Profit Target', values: ['+8t ($100)', '+16t ($200)', '$300 max'] },
                { label: 'Stop Loss', values: ['-8t (-$100)', '-8t (-$100)', '-$200 max'] },
              ]}
            />
            <div className="mt-4">
              <Callout icon={Lightbulb} tone="tip">
                Save both brackets as ATM templates. Ticks are NEVER typed during a live setup.
              </Callout>
            </div>
          </SectionCard>

          <div className="space-y-4">
            <SectionCard title="Daily Limits">
              <KVTable
                rows={[
                  ['Daily Profit Target — STOP when hit', '+$100'],
                  ['Daily Max Loss — STOP when hit', '-$100'],
                  ['Max Trades Per Day (hard ceiling)', '5 trades'],
                  ['Consecutive Loss Limit', '3 in a row = done'],
                  ['Mandatory Cooldown After Any Loss', '10 minutes'],
                ]}
              />
            </SectionCard>
            <SectionCard title="Session Structure">
              <KVTable rows={SESSION_ROWS} />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                Daily max loss and profit target cover BOTH sessions. Hitting -$100 at 2AM ends your entire trading
                day — RTH does not reset it.
              </p>
            </SectionCard>
          </div>
        </div>

        <div className="mt-4">
          <SectionCard title="Kill Switch Rules — No Exceptions">
            <KillSwitch rules={KILL_SWITCH_BASE('+$100', '-$100')} />
          </SectionCard>
        </div>

        <div className="mt-4">
          <SectionCard title="25K Payout Caps by Cycle">
            <KVTable
              rows={[
                ['Payouts 1–6', '$1,000 each (min balance $26,600)'],
                ['Account closes after', '6th payout'],
                ['Max total extractable from one 25K PA', '$6,000'],
              ]}
            />
          </SectionCard>
        </div>
      </div>

      {/* ── SECTION 2: 50K ── */}
      <div className="pt-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Section 2 — 50K Account</h2>
        <div className="h-0.5 w-12 bg-yellow-500 rounded-full mb-4" />
        <div className="grid gap-4 md:grid-cols-2">
          <SectionCard title="Account Parameters">
            <KVTable
              rows={[
                ['Account Size', '$50,000'],
                ['Trailing Drawdown Limit', '$1,000'],
                ['Eval Profit Target', '$3,000'],
                ['PA Safety Net (min balance floor)', '$52,100'],
                ['PA Min Balance to Request Payout', '$52,600'],
                ['PA Profit Needed Before First Payout', '$2,600'],
                ['PA Qualifying Days', '5 days @ $200 min (non-consecutive ok)'],
                ['50% Consistency Rule', 'No single day ≥ 50% of total profit'],
                ['Max Payouts Per PA', '6'],
                ['Min Payout Amount', '$500'],
              ]}
            />
          </SectionCard>

          <div className="space-y-4">
            <SectionCard title="Position Structure">
              <KVTable
                rows={[
                  ['Default (always)', '/MES — 4 contracts'],
                  ['All 3 ES conditions met', '/ES — 1 contract'],
                ]}
              />
              <div className="mt-4">
                <Callout icon={AlertTriangle} tone="warn">
                  Never trade /MES and /ES simultaneously. You are always in ONE bracket at a time.
                </Callout>
              </div>
            </SectionCard>

            <SectionCard title="/ES Authorization — All 3 Conditions Required">
              <KVTable
                rows={[
                  ['Account Status', 'Eval OR PA — available in both'],
                  ['Buffer Above Drawdown', '$500+ above locked drawdown'],
                  ['ATR at Entry', 'Under 6 — else /ES off the table'],
                ]}
              />
            </SectionCard>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mt-4">
          <SectionCard title="Bracket Order Specifications">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">/MES</p>
            <BracketTable
              cols={['Leg 1', 'Leg 2', 'Total']}
              rows={[
                { label: 'Contracts', values: ['2 MES', '2 MES', '4 MES'] },
                { label: 'Profit Target', values: ['+8t ($20)', '+16t ($40)', '$60 max'] },
                { label: 'Stop Loss', values: ['-8t (-$20)', '-8t (-$20)', '-$40 max'] },
                { label: 'Breakeven', values: ['—', 'Move to BE when Leg 1 fills', ''], muted: true },
              ]}
            />
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-4 mb-2">/ES (if authorized)</p>
            <BracketTable
              cols={['Leg 1', 'Leg 2', 'Total']}
              rows={[
                { label: 'Contracts', values: ['1 ES', '1 ES', '1 ES'] },
                { label: 'Profit Target', values: ['+8t ($100)', '+16t ($200)', '$300 max'] },
                { label: 'Stop Loss', values: ['-8t (-$100)', '-8t (-$100)', '-$200 max'] },
              ]}
            />
            <div className="mt-4">
              <Callout icon={Lightbulb} tone="tip">
                Save both brackets as ATM templates. Ticks are NEVER typed during a live setup.
              </Callout>
            </div>
          </SectionCard>

          <div className="space-y-4">
            <SectionCard title="Daily Limits">
              <KVTable
                rows={[
                  ['Daily Profit Target — STOP when hit', '+$200'],
                  ['Daily Max Loss — STOP when hit', '-$200'],
                  ['Max Trades Per Day (hard ceiling)', '5 trades'],
                  ['Consecutive Loss Limit', '3 in a row = done'],
                  ['Mandatory Cooldown After Any Loss', '10 minutes'],
                ]}
              />
            </SectionCard>
            <SectionCard title="Session Structure">
              <KVTable rows={SESSION_ROWS} />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                Daily max loss and profit target cover BOTH sessions. Hitting -$200 at 2AM ends your entire trading
                day — RTH does not reset it.
              </p>
            </SectionCard>
          </div>
        </div>

        <div className="mt-4">
          <SectionCard title="Kill Switch Rules — No Exceptions">
            <KillSwitch rules={KILL_SWITCH_BASE('+$200', '-$200')} />
          </SectionCard>
        </div>

        <div className="mt-4">
          <SectionCard title="50K Payout Caps by Cycle">
            <BracketTable
              cols={['Cap']}
              rows={[
                { label: 'Payout 1 (min balance $52,600)', values: ['$1,500'] },
                { label: 'Payout 2', values: ['$2,000'] },
                { label: 'Payout 3', values: ['$2,500'] },
                { label: 'Payout 4', values: ['$2,500'] },
                { label: 'Payout 5', values: ['$3,000'] },
                { label: 'Payout 6 (account closes after)', values: ['$3,000'] },
                { label: 'Max total extractable from one 50K PA', values: ['$15,500'] },
              ]}
            />
          </SectionCard>
        </div>
      </div>

      {/* ── SECTION 3: QUICK REFERENCE ── */}
      <div className="pt-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Section 3 — Side-by-Side Quick Reference</h2>
        <div className="h-0.5 w-12 bg-yellow-500 rounded-full mb-4" />
        <SectionCard title="25K vs 50K">
          <BracketTable
            cols={['25K', '50K']}
            rows={[
              { label: 'Trailing Drawdown', values: ['$500', '$1,000'] },
              { label: 'Eval Profit Target', values: ['$1,500', '$3,000'] },
              { label: 'PA Safety Net', values: ['$26,100', '$52,100'] },
              { label: 'Min Balance for Payout', values: ['$26,600', '$52,600'] },
              { label: 'Profit Before First Payout', values: ['$1,600', '$2,600'] },
              { label: 'Qualifying Days', values: ['5 @ $100', '5 @ $200'] },
              { label: 'Daily Profit Target', values: ['$100', '$200'] },
              { label: 'Daily Max Loss', values: ['-$100', '-$200'] },
              { label: 'Max Trades Per Day', values: ['5', '5'] },
              { label: 'Default Instrument', values: ['/MES — 2', '/MES — 4'] },
              { label: '/ES Contracts (if authorized)', values: ['1', '1'] },
              { label: '/ES Available During Eval?', values: ['NO', 'YES'] },
              { label: '/ES Buffer Required', values: ['$1,500+', '$500+'] },
              { label: '/ES ATR Requirement', values: ['Under 6', 'Under 6'] },
              { label: 'Consecutive Loss Limit', values: ['3 = done', '3 = done'] },
              { label: 'Cooldown After Loss', values: ['10 min', '10 min'] },
              { label: 'Max Payouts Per PA', values: ['6', '6'] },
              { label: 'Max Per Payout (Cycle 1)', values: ['$1,000', '$1,500'] },
              { label: 'Max Total From One PA', values: ['$6,000', '$15,500'] },
              { label: '50% Consistency Rule', values: ['Yes', 'Yes'] },
            ]}
          />
        </SectionCard>
      </div>

      {/* THE GOLDEN RULE */}
      <div className="rounded-xl border-2 border-yellow-500/40 bg-yellow-500/5 p-6 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-yellow-600 dark:text-yellow-500 mb-2">
          The Golden Rule
        </p>
        <p className="text-base font-semibold text-gray-900 dark:text-white">
          This is a business. Every rule above is a business policy.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Policies are not negotiated in the moment. They are followed every time.
        </p>
      </div>
    </div>
  )
}
