import { ScrollText, AlertTriangle, Lightbulb, ShieldCheck } from 'lucide-react'

// Static reference page — the Apex Trader Funding Unified Trading Framework.
// Single source of truth for 25K and 50K account rules (Eval & PA identical).
// Risk numbers follow trading_plan_apex_50k.pdf (Apex LEGACY evals) and mirror
// TRADING_PLAN in lib/apex-config.ts — change both together.

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

const KILL_SWITCH_BASE = (target: string, loss: string) => [
  `Hit ${target} profit → stop trading, day is done`,
  `Hit ${loss} loss → stop trading, day is done`,
  'Two losers → stop trading, day is done (that is the daily max)',
  'No re-entries after a max-loss morning — walk away',
  'Never increase size to catch up after a red day',
  'Take profit at the fixed target — no runners (the trail counts open profit)',
  '10-minute mandatory cooldown after every loss',
  'No trades during FOMC, CPI, NFP or any major scheduled news events',
  'Never widen a stop loss — ever',
  'Never add to a losing position',
  'Avoid midday chop (12:00 PM – 2:00 PM CT) unless setup is crystal clear',
  '/ES only when every /ES authorization condition is met — missing any one = /MES only',
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
                ['Trailing Drawdown (legacy, intraday — counts open profit)', '$1,500'],
                ['Eval Profit Target', '$1,500'],
                ['Eval Minimum Trading Days', '7'],
                ['Apex Daily Loss Limit', 'None — yours is the only one'],
                ['PA Trail Locks At (start + $100)', '$25,100'],
                ['PA Min Balance to Request Payout', '$26,600'],
                ['PA Profit Needed Before First Payout', '$1,600'],
                ['PA Qualifying Days', '5 days @ $100 min (non-consecutive ok)'],
                ['30% Consistency Rule (legacy PA)', 'No single day ≥ 30% of profit since last payout'],
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
                  ['Per-Trade Risk (1:2 reward)', '$60–$75'],
                  ['Default (always)', '/MES — 2 contracts (16t stop, $40)'],
                  ['Breakeven Trigger', 'Trade up ~$100+'],
                  ['/ES (authorized only)', '1 ES, eval or PA — see below'],
                ]}
              />
              <div className="mt-4">
                <Callout icon={AlertTriangle} tone="warn">
                  Never trade /MES and /ES simultaneously. You are always in ONE bracket at a time.
                </Callout>
              </div>
            </SectionCard>

            <SectionCard title="/ES Authorization — Both Conditions Required">
              <KVTable
                rows={[
                  ['Account Status', 'Eval OR PA — available in both'],
                  ['ATR at Entry', 'Under 6 — at 6 or above, /MES only'],
                ]}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                1 ES risks $100 behind its 8-tick stop — above the $60–$75 per-trade band, by choice.
                One ES loser uses $100 of the -$150 daily stop, so a second ES loser closes the day $50 past it.
              </p>
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
                { label: 'Profit Target', values: ['+16t ($20)', '+32t ($40)', '+$60 max'] },
                { label: 'Stop Loss', values: ['-16t (-$20)', '-16t (-$20)', '-$40 max'] },
                { label: 'Breakeven', values: ['—', 'Move to BE when Leg 1 fills', ''], muted: true },
              ]}
            />
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-4 mb-2">/ES (if authorized)</p>
            <BracketTable
              cols={['Single target — no runners']}
              rows={[
                { label: 'Contracts', values: ['1 ES'] },
                { label: 'Profit Target', values: ['+12t ($150)'] },
                { label: 'Stop Loss', values: ['-8t (-$100)'] },
                { label: 'Breakeven', values: ['None — the +12t target is the ~$150 trigger'], muted: true },
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
                  ['Daily Profit Target — STOP when hit', '+$225'],
                  ['Daily Max Loss (HARD) — STOP when hit', '-$150'],
                  ['Enforced in Tradovate', 'Both limits above — two losers is on you'],
                  ['Loss Limit', 'Two losers = done'],
                  ['Mandatory Cooldown After Any Loss', '10 minutes'],
                ]}
              />
            </SectionCard>
            <SectionCard title="Session Structure">
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                Daily max loss and profit target cover BOTH sessions. Hitting -$150 at 2AM ends your entire trading
                day — RTH does not reset it.
              </p>
            </SectionCard>
          </div>
        </div>

        <div className="mt-4">
          <SectionCard title="Kill Switch Rules — No Exceptions">
            <KillSwitch rules={KILL_SWITCH_BASE('+$225', '-$150')} />
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
                ['Trailing Drawdown (legacy, intraday — counts open profit)', '$2,500'],
                ['Eval Profit Target', '$3,000'],
                ['Eval Minimum Trading Days', 'None'],
                ['Apex Daily Loss Limit', 'None — yours is the only one'],
                ['PA Trail Locks At (start + $100)', '$50,100'],
                ['PA Min Balance to Request Payout', '$52,600'],
                ['PA Profit Needed Before First Payout', '$2,600'],
                ['PA Qualifying Days', '5 days @ $200 min (non-consecutive ok)'],
                ['30% Consistency Rule (legacy PA)', 'No single day ≥ 30% of profit since last payout'],
                ['Max Payouts Per PA', '6'],
                ['Min Payout Amount', '$500'],
              ]}
            />
          </SectionCard>

          <div className="space-y-4">
            <SectionCard title="Position Structure">
              <KVTable
                rows={[
                  ['Per-Trade Risk (1:2 reward)', '$100–$125'],
                  ['Default (always)', '/MES — 2 contracts (16t stop, $40)'],
                  ['Breakeven Trigger', 'Trade up ~$150+'],
                  ['/ES (authorized only)', '1 contract ($100 at 8 ticks)'],
                ]}
              />
              <div className="mt-4">
                <Callout icon={AlertTriangle} tone="warn">
                  Never trade /MES and /ES simultaneously. You are always in ONE bracket at a time.
                </Callout>
              </div>
            </SectionCard>

            <SectionCard title="/ES Authorization — Both Conditions Required">
              <KVTable
                rows={[
                  ['Account Status', 'Eval OR PA — available in both'],
                  ['ATR at Entry', 'Under 6 — at 6 or above, /MES only'],
                ]}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                1 ES risks $100 behind its 8-tick stop with a +12-tick ($150) target (1:1.5) — inside the
                plan&apos;s $100–$125 band. No extra buffer gate:
                it adds no risk the plan doesn&apos;t already allow.
              </p>
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
                { label: 'Profit Target', values: ['+16t ($20)', '+32t ($40)', '+$60 max'] },
                { label: 'Stop Loss', values: ['-16t (-$20)', '-16t (-$20)', '-$40 max'] },
                { label: 'Breakeven', values: ['—', 'Move to BE when Leg 1 fills', ''], muted: true },
              ]}
            />
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-4 mb-2">/ES (if authorized)</p>
            <BracketTable
              cols={['Single target — no runners']}
              rows={[
                { label: 'Contracts', values: ['1 ES'] },
                { label: 'Profit Target', values: ['+12t ($150)'] },
                { label: 'Stop Loss', values: ['-8t (-$100)'] },
                { label: 'Breakeven', values: ['None — the +12t target is the ~$150 trigger'], muted: true },
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
                  ['Daily Profit Target — STOP when hit', '+$375'],
                  ['Daily Max Loss (HARD) — STOP when hit', '-$250'],
                  ['Enforced in Tradovate', 'Both limits above — two losers is on you'],
                  ['Loss Limit', 'Two losers = done'],
                  ['Mandatory Cooldown After Any Loss', '10 minutes'],
                ]}
              />
            </SectionCard>
            <SectionCard title="Session Structure">
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 leading-relaxed">
                Daily max loss and profit target cover BOTH sessions. Hitting -$250 at 2AM ends your entire trading
                day — RTH does not reset it.
              </p>
            </SectionCard>
          </div>
        </div>

        <div className="mt-4">
          <SectionCard title="Kill Switch Rules — No Exceptions">
            <KillSwitch rules={KILL_SWITCH_BASE('+$375', '-$250')} />
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
              { label: 'Trailing Drawdown (legacy, intraday)', values: ['$1,500', '$2,500'] },
              { label: 'Eval Profit Target', values: ['$1,500', '$3,000'] },
              { label: 'Eval Minimum Trading Days', values: ['7', 'None'] },
              { label: 'Per-Trade Risk (1:2)', values: ['$60–$75', '$100–$125'] },
              { label: 'Breakeven Trigger', values: ['~$100', '~$150'] },
              { label: 'PA Trail Locks At', values: ['$25,100', '$50,100'] },
              { label: 'Min Balance for Payout', values: ['$26,600', '$52,600'] },
              { label: 'Profit Before First Payout', values: ['$1,600', '$2,600'] },
              { label: 'Qualifying Days', values: ['5 @ $100', '5 @ $200'] },
              { label: 'Daily Profit Target', values: ['$225', '$375'] },
              { label: 'Daily Max Loss (HARD)', values: ['-$150', '-$250'] },
              { label: 'Default Instrument', values: ['/MES — 2 (16t stop)', '/MES — 2 (16t stop)'] },
              { label: '/MES Targets (Leg 1 / Leg 2)', values: ['+16t / +32t', '+16t / +32t'] },
              { label: '/ES Contracts (if authorized)', values: ['1', '1'] },
              { label: '/ES Risk at 8 Ticks vs Plan Max', values: ['$100 > $75 max (by choice)', '$100 ≤ $125 max'] },
              { label: '/ES Available During Eval?', values: ['YES', 'YES'] },
              { label: '/ES ATR Requirement', values: ['Under 6', 'Under 6'] },
              { label: 'Loss Limit', values: ['2 losers = done', '2 losers = done'] },
              { label: 'Cooldown After Loss', values: ['10 min', '10 min'] },
              { label: 'Max Payouts Per PA', values: ['6', '6'] },
              { label: 'Max Per Payout (Cycle 1)', values: ['$1,000', '$1,500'] },
              { label: 'Max Total From One PA', values: ['$6,000', '$15,500'] },
              { label: '30% Consistency Rule (legacy PA)', values: ['Yes', 'Yes'] },
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
