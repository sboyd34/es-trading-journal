// Run: npx tsx scripts/test-account-day-rules.mts
import { accountDayFacts, type DayTrade } from '../lib/account-day-rules'

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`PASS  ${label}`)
  } else {
    failures++
    console.log(`FAIL  ${label}\n  expected ${e}\n  actual   ${a}`)
  }
}
const es = (no: number, net_pnl: number, quantity = 1, atr_at_entry: number | null = 4): DayTrade => ({ no, instrument: 'ES', quantity, net_pnl, atr_at_entry })
const mes = (no: number, net_pnl: number, quantity = 2): DayTrade => ({ no, instrument: 'MES', quantity, net_pnl, atr_at_entry: null })

// 2026-11-23, the day the old review got wrong. Numbers are the day's
// chronological trade numbers across both accounts.
const day50k = [es(5, -103.1), es(6, 268.8, 2), es(14, 146.9), es(15, -140.6), es(16, -115.6), es(17, 293.8, 2), es(18, 193.8, 2)]
const f50 = accountDayFacts(day50k, { account_size: 50000, mode: 'evaluation' })!
check('50K: hard stop is the 2nd loser, #15 — not the -$250 net', [f50.hardStopAt, f50.hardStopReason], [15, 'loser #2 of the day (plan: 2 losers, done)'])
check('50K: #16-18 traded after the stop', f50.tradesAfterHardStop, [16, 17, 18])
// Running 50K net: -103.1, 165.7, 312.6, 172.0, 56.4, 350.2, 544.0 — first at $375 on the last trade.
check('50K: profit target ($375) reached at #18, nothing after', [f50.profitTargetAt, f50.tradesAfterProfitTarget], [18, []])
check('50K: 2x ES on #6, #17, #18', f50.sizeBreaches.map((b) => b.no), [6, 17, 18])
check('50K: day finished green', Math.round(f50.net * 100) / 100, 544)

const day25k = [es(1, 146.9), es(2, -115.6), es(3, 146.9), es(4, 59.4), es(7, -115.6), es(8, 146.9), es(9, -128.1), es(10, 146.9), es(11, 146.9), es(12, -103.1), es(13, 146.9)]
const f25 = accountDayFacts(day25k, { account_size: 25000, mode: 'evaluation' })!
check('25K: stop at #7, the 2nd loser', f25.hardStopAt, 7)
check('25K: 4 losers', f25.losers, 4)
check('25K eval: 1x ES is allowed — no size breaches', f25.sizeBreaches, [])
// Running 25K net: 146.9, 31.3, 178.2, 237.6 — first at $225 on #4.
check('25K: profit target ($225) reached at #4', f25.profitTargetAt, 4)
const es2on25 = accountDayFacts([es(1, 200, 2)], { account_size: 25000, mode: 'evaluation' })!
check('25K: 2x ES still breaches the 1-contract max', es2on25.sizeBreaches.map((b) => b.no), [1])

// Net hard stop before the loser count: one -$160 loser on a 25K.
const big = accountDayFacts([mes(1, -160), mes(2, 20)], { account_size: 25000, mode: 'evaluation' })!
check('25K: -$160 single loser trips the -$150 net stop', [big.hardStopAt, big.hardStopReason, big.tradesAfterHardStop], [1, 'day net reached -$150 hard stop', [2]])
check('MES at 2 contracts is within the bracket', big.sizeBreaches, [])

const mes3 = accountDayFacts([mes(1, 30, 3)], { account_size: 50000, mode: 'evaluation' })!
check('3x MES breaches the 2-contract bracket', mes3.sizeBreaches.map((b) => b.no), [1])

const clean = accountDayFacts([es(1, 150), es(2, -100), es(3, 150)], { account_size: 50000, mode: 'evaluation' })!
check('one loser, under target: nothing flagged', [clean.hardStopAt, clean.profitTargetAt, clean.sizeBreaches], [null, null, []])

// ATR gate: /ES only under 6. At or above is a breach; not recorded is unverified.
const atr = accountDayFacts([es(1, 50, 1, 5.99), es(2, 50, 1, 6), es(3, 50, 1, 7.67), es(4, 50, 1, null), mes(5, 20)], { account_size: 50000, mode: 'evaluation' })!
check('ATR 6 and 7.67 breach; 5.99 is fine', atr.sizeBreaches.map((b) => b.no), [2, 3])
check('ES with no ATR is unverified, not a breach; MES is never checked', atr.esAtrUnknown, [4])

check('no written plan (100K) returns null', accountDayFacts([es(1, 10)], { account_size: 100000, mode: 'evaluation' }), null)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
