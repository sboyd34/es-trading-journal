import { matchFillsFlatToFlat, parseTradovateCSV, type MatchFill } from '../lib/tradovate-parser'

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

const base = { contractName: 'ESM6', instrument: 'ES', date: '2026-06-16', accountId: '1' }
const ts = (s: string) => `2026-06-16T${s}Z`

// Scenario 1 — bracket entry fills in 2 pieces, exits once → ONE row.
{
  const fills: MatchFill[] = [
    { ...base, id: '1', action: 'Buy', qty: 2, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: '2', action: 'Buy', qty: 1, price: 5001, timestamp: ts('14:30:01') },
    { ...base, id: '3', action: 'Sell', qty: 3, price: 5010, timestamp: ts('14:35:00') },
  ]
  const feeMap = new Map<string, number>([['1', 2.0], ['2', 1.0], ['3', 3.0]])
  const t = matchFillsFlatToFlat(fills, feeMap)
  check('S1 count', t.length, 1)
  check('S1 qty', t[0].quantity, 3)
  check('S1 direction', t[0].direction, 'long')
  check('S1 entry_price', Math.round(t[0].entry_price * 1000) / 1000, 5000.333)
  check('S1 exit_price', t[0].exit_price, 5010)
  check('S1 commission (real sum)', t[0].commission, 6.0)
  check('S1 dedup key', t[0].tradovate_order_id, '1_3')
}

// Scenario 2 — one entry, two scale-out exits → ONE row, blended exit.
{
  const fills: MatchFill[] = [
    { ...base, id: '10', action: 'Buy', qty: 3, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: '11', action: 'Sell', qty: 2, price: 5010, timestamp: ts('14:35:00') },
    { ...base, id: '12', action: 'Sell', qty: 1, price: 5008, timestamp: ts('14:36:00') },
  ]
  const feeMap = new Map<string, number>([['10', 3.0], ['11', 2.0], ['12', 1.0]])
  const t = matchFillsFlatToFlat(fills, feeMap)
  check('S2 count', t.length, 1)
  check('S2 qty', t[0].quantity, 3)
  check('S2 exit_price', Math.round(t[0].exit_price * 1000) / 1000, 5009.333)
  check('S2 commission', t[0].commission, 6.0)
  check('S2 dedup key', t[0].tradovate_order_id, '10_12')
}

// Scenario 3 — flip through zero: Sell 3 while long 2 → close long(2) + open short(1).
{
  const fills: MatchFill[] = [
    { ...base, id: '20', action: 'Buy', qty: 2, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: '21', action: 'Sell', qty: 3, price: 5010, timestamp: ts('14:35:00') },
    { ...base, id: '22', action: 'Buy', qty: 1, price: 5005, timestamp: ts('14:40:00') },
  ]
  // id21 fee 3.0 over qty 3 → 1.0/contract: 2.0 to the long close, 1.0 to the short open.
  const feeMap = new Map<string, number>([['20', 2.0], ['21', 3.0], ['22', 1.0]])
  const t = matchFillsFlatToFlat(fills, feeMap)
  check('S3 count', t.length, 2)
  check('S3 t1 direction', t[0].direction, 'long')
  check('S3 t1 qty', t[0].quantity, 2)
  check('S3 t1 commission', t[0].commission, 4.0) // 2.0 (id20) + 2.0 (2/3 of id21)
  check('S3 t1 key', t[0].tradovate_order_id, '20_21')
  check('S3 t2 direction', t[1].direction, 'short')
  check('S3 t2 qty', t[1].quantity, 1)
  check('S3 t2 commission', t[1].commission, 2.0) // 1.0 (1/3 of id21) + 1.0 (id22)
  check('S3 t2 key', t[1].tradovate_order_id, '21_22')
}

// Scenario 4 — missing real fee → fall back to ES round-turn estimate (4.10).
{
  const fills: MatchFill[] = [
    { ...base, id: '30', action: 'Buy', qty: 1, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: '31', action: 'Sell', qty: 1, price: 5010, timestamp: ts('14:35:00') },
  ]
  const feeMap = new Map<string, number>([['30', 2.05]]) // id31 missing
  const t = matchFillsFlatToFlat(fills, feeMap)
  check('S4 count', t.length, 1)
  check('S4 commission (estimate)', t[0].commission, 4.1)
}

// Scenario 5 — CSV path: two partial-fill rows of ONE bracket long collapse to
// a single round-turn trade (the bug this rework fixes). Empty feeMap → the ES
// round-turn estimate of 4.10/contract → 12.30 for 3 contracts.
{
  const csv = [
    'symbol,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,buyFillId,sellFillId,account',
    'ESM6,2,5000,5010,$20.00,06/16/2026 09:30:00,06/16/2026 09:35:00,1,3,APEX-1',
    'ESM6,1,5001,5010,$9.00,06/16/2026 09:30:01,06/16/2026 09:36:00,2,4,APEX-1',
  ].join('\n')
  const t = parseTradovateCSV(csv)
  check('S5 count (rows collapse to one trade)', t.length, 1)
  check('S5 qty', t[0].quantity, 3)
  check('S5 direction', t[0].direction, 'long')
  check('S5 entry_price', Math.round(t[0].entry_price * 1000) / 1000, 5000.333)
  check('S5 exit_price', t[0].exit_price, 5010)
  check('S5 commission (estimate)', t[0].commission, 12.3)
  check('S5 dedup key', t[0].tradovate_order_id, '1_4')
  check('S5 broker_account_id', t[0].broker_account_id, 'APEX-1')
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
