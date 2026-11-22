import {
  matchFillsFlatToFlat,
  matchFillsWithDiagnostics,
  parseTradovateCSV,
  type MatchFill,
} from '../lib/tradovate-parser'

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

// Scenario 4 — missing real fee → fall back to ES round-turn estimate (3.10).
{
  const fills: MatchFill[] = [
    { ...base, id: '30', action: 'Buy', qty: 1, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: '31', action: 'Sell', qty: 1, price: 5010, timestamp: ts('14:35:00') },
  ]
  const feeMap = new Map<string, number>([['30', 2.05]]) // id31 missing
  const t = matchFillsFlatToFlat(fills, feeMap)
  check('S4 count', t.length, 1)
  check('S4 commission (estimate)', t[0].commission, 3.1)
}

// Scenario 5 — CSV path: two partial-fill rows of ONE bracket long collapse to
// a single round-turn trade (the bug this rework fixes). Empty feeMap → the ES
// round-turn estimate of 3.10/contract → 9.30 for 3 contracts.
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
  check('S5 commission (estimate)', t[0].commission, 9.3)
  check('S5 dedup key', t[0].tradovate_order_id, '1_4')
  check('S5 broker_account_id', t[0].broker_account_id, 'APEX-1')
}

// Scenario 6 — THE BUG. The export window opens while a position is already
// open, so the matcher's flat-start assumption is false and every pairing
// shifts by one, blending entries from price regimes hours apart.
//
//   carry (opening fill is OUTSIDE the window): long 1 ES
//   window: Sell 7606 · Buy 7600 · Sell 7604 · Buy 7380 · Sell 7384
//
//   truth:   close the carry at 7606, then two +4pt long scalps = +$400
//   matcher: Sell 7606 reads as a SHORT ENTRY, shifting every pair by one —
//              short 7606 -> 7600    +6pt  =    +$300
//              short 7604 -> 7380  +224pt  = +$11,200   <- cross-regime phantom
//              short 7384 -> (never closes, dropped)
//                                            +$11,500
//
// Same magnitude and shape as the real -$12,593.70 row in the live table.
// The detectable invariant: signed fill quantities sum to -1, not 0. A
// self-contained flat-to-flat stream ALWAYS sums to 0, so a nonzero sum is
// proof the group is not self-contained — and we refuse to emit rather than
// fabricate.
{
  const fills: MatchFill[] = [
    { ...base, id: '40', action: 'Sell', qty: 1, price: 7606, timestamp: ts('14:30:00') },
    { ...base, id: '41', action: 'Buy', qty: 1, price: 7600, timestamp: ts('14:31:00') },
    { ...base, id: '42', action: 'Sell', qty: 1, price: 7604, timestamp: ts('14:32:00') },
    { ...base, id: '43', action: 'Buy', qty: 1, price: 7380, timestamp: ts('19:45:00') },
    { ...base, id: '44', action: 'Sell', qty: 1, price: 7384, timestamp: ts('19:46:00') },
  ]
  const { trades, imbalances } = matchFillsWithDiagnostics(fills, new Map())
  check('S6 emits NO fabricated trades', trades.length, 0)
  check('S6 reports one imbalance', imbalances.length, 1)
  check('S6 imbalance netQty', imbalances[0]?.netQty, -1)
  check('S6 imbalance contract', imbalances[0]?.contractName, 'ESM6')
  check('S6 imbalance date', imbalances[0]?.date, '2026-06-16')
  check('S6 imbalance fillCount', imbalances[0]?.fillCount, 5)
}

// Scenario 7 — the guard is per-group, not global. A balanced group must still
// emit normally even when an unbalanced group rides along in the same payload,
// otherwise one bad contract-day silently voids a whole import.
{
  const fills: MatchFill[] = [
    // balanced: ES, one clean round turn
    { ...base, id: '50', action: 'Buy', qty: 1, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: '51', action: 'Sell', qty: 1, price: 5010, timestamp: ts('14:35:00') },
    // unbalanced: MES, opened inside the window and never closed
    {
      contractName: 'MESM6',
      instrument: 'MES',
      date: '2026-06-16',
      accountId: '1',
      id: '52',
      action: 'Buy',
      qty: 2,
      price: 5000,
      timestamp: ts('14:40:00'),
    },
  ]
  const { trades, imbalances } = matchFillsWithDiagnostics(fills, new Map())
  check('S7 balanced group still emits', trades.length, 1)
  check('S7 emitted trade is the ES round turn', trades[0]?.tradovate_order_id, '50_51')
  check('S7 reports the MES imbalance', imbalances.length, 1)
  check('S7 imbalance contract', imbalances[0]?.contractName, 'MESM6')
  check('S7 imbalance netQty', imbalances[0]?.netQty, 2)
}

// Scenario 8 — THE PAIRING SCRAMBLE. Two complete, correct CSV rows whose
// positions overlap in time and run opposite directions:
//
//   row A: LONG   buy 7600 @09:00 -> sell 7604 @09:05  = +4pt = +$200
//   row B: SHORT  sell 7606 @09:02 -> buy 7602 @09:07  = +4pt = +$200
//
// Exploding these into four fills and re-pairing them in time order made the
// long's real exit (7604) serve as the short's entry:
//   long 7600 -> 7606 (+$300) · short 7604 -> 7602 (+$100)
// Same $400 total — total gross = pv * SUM(sell - buy) is invariant under
// mispairing — but both rows' prices, and every per-trade stat built on them
// (R-multiple, MFE/MAE, win/loss attribution), were fiction.
//
// Keeping Tradovate's own pairing is what fixes it. Nothing here is reachable
// by the flat-start guard: each row contributes +qty and -qty, so the group's
// signed sum is 0 and S6's invariant stays silent. Two independent defects.
{
  const csv = [
    'symbol,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,buyFillId,sellFillId,account',
    'ESM6,1,7600,7604,$200.00,11/05/2026 09:00:00,11/05/2026 09:05:00,1,2,APEX-1',
    'ESM6,1,7602,7606,$200.00,11/05/2026 09:07:00,11/05/2026 09:02:00,3,4,APEX-1',
  ].join('\n')
  const t = parseTradovateCSV(csv)
  check('S8 both rows survive as separate trades', t.length, 2)
  check('S8 long direction', t[0]?.direction, 'long')
  check('S8 long entry (not blended)', t[0]?.entry_price, 7600)
  check('S8 long exit is its OWN exit, not the short entry', t[0]?.exit_price, 7604)
  check('S8 long gross matches Tradovate pnl', t[0]?.gross_pnl, 200)
  check('S8 short direction', t[1]?.direction, 'short')
  check('S8 short entry is the sell leg', t[1]?.entry_price, 7606)
  check('S8 short exit is the buy leg', t[1]?.exit_price, 7602)
  check('S8 short gross matches Tradovate pnl', t[1]?.gross_pnl, 200)
  check('S8 dedup key is entry_exit fill order', t[1]?.tradovate_order_id, '4_3')
}

// Scenario 9 — a same-direction re-entry AFTER the position went flat must stay
// two trades. This is why shouldMergeRoundTurns has no "within N seconds" fudge
// factor: flat is flat, and a threshold would fuse two real setups into one
// blended row with an off-tick average price.
{
  const csv = [
    'symbol,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,buyFillId,sellFillId,account',
    'ESM6,1,7600,7604,$200.00,11/05/2026 09:00:00,11/05/2026 09:05:00,10,11,APEX-1',
    'ESM6,1,7605,7609,$200.00,11/05/2026 09:06:00,11/05/2026 09:10:00,12,13,APEX-1',
  ].join('\n')
  const t = parseTradovateCSV(csv)
  check('S9 flat-then-reenter stays two trades', t.length, 2)
  check('S9 first keeps its own prices', t[0]?.entry_price, 7600)
  check('S9 second keeps its own prices', t[1]?.entry_price, 7605)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
