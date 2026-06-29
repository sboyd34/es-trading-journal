import Papa from 'papaparse'

export interface ParsedTrade {
  date: string
  entry_time: string
  exit_time: string
  direction: 'long' | 'short'
  quantity: number
  entry_price: number
  exit_price: number
  gross_pnl: number
  commission: number
  net_pnl: number
  tradovate_order_id: string
  instrument: string
  pnl_raw: string
  broker_account_id: string | null
}

export const POINT_VALUES: Record<string, number> = {
  ES: 50,
  NQ: 20,
  MES: 5,
  MNQ: 2,
}

// All-in round-turn fees per contract: broker commission + exchange + NFA + clearing.
// Single source of truth for BOTH import paths (this CSV parser and the live API
// sync in tradovate-api.ts) so the two can never diverge again — that divergence
// (0.31/3.10 here vs a flat 4.10 there, all brokerage-only) is what made journal
// net_pnl drift above Tradovate's true net. MES & NQ are reconciled from real
// 2026-06-16 fills against Tradovate's reported net; ES & MNQ are best estimates —
// verify against a Tradovate statement if your commission plan changes.
export const ALLIN_FEE_PER_CONTRACT: Record<string, number> = {
  ES: 4.10,
  NQ: 3.47,
  MES: 1.01,
  MNQ: 1.04,
}

// Round-turn fee for a filled quantity, rounded to cents. Unmapped instruments
// fall back to the ES rate (mirrors POINT_VALUES' ES-default convention).
export function feeForContracts(instrument: string, qty: number): number {
  const rate = ALLIN_FEE_PER_CONTRACT[instrument] ?? ALLIN_FEE_PER_CONTRACT.ES
  return Math.round(qty * rate * 100) / 100
}

// Longer prefixes must come first (MES before ES, MNQ before NQ)
const INSTRUMENT_PREFIXES = ['MES', 'MNQ', 'RTY', 'YM', 'NQ', 'ES', 'GC', 'CL']

function extractInstrument(symbol: string): string {
  const upper = symbol.toUpperCase()
  for (const prefix of INSTRUMENT_PREFIXES) {
    if (upper.startsWith(prefix)) return prefix
  }
  return 'ES'
}

// MM/DD/YYYY HH:MM:SS → Date
function parseTimestamp(ts: string): Date {
  const [datePart, timePart] = ts.trim().split(' ')
  const [month, day, year] = datePart.split('/')
  return new Date(
    `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`
  )
}

interface RawRow {
  symbol?: string
  buyFillId?: string
  sellFillId?: string
  qty?: string
  buyPrice?: string
  sellPrice?: string
  pnl?: string
  boughtTimestamp?: string
  soldTimestamp?: string
  [key: string]: string | undefined
}

// ── Flat-to-flat matcher (shared by CSV import and the live API sync) ──────────
// IDs are strings so the same matcher serves the CSV path (Tradovate fill-id
// strings) and the API path (numeric fill ids, stringified at the call site).
export interface MatchFill {
  id: string
  action: 'Buy' | 'Sell'
  qty: number
  price: number
  timestamp: string
  accountId?: string
  contractName: string
  instrument: string
  date: string
}

// Within each (account, contract, date) bucket, walk fills in time order
// tracking signed net position. Every time the position returns to flat, emit
// exactly one round-turn trade — so a bracket order that fills in N pieces and
// exits in M pieces becomes a single journal row. A fill that overshoots flat (a
// position flip) is split: the portion that reaches flat closes the current
// trade, the remainder opens the next. Commission is the summed real per-fill
// fee for every fill portion in the lifecycle; if any fill lacks a real fee, the
// whole trade falls back to the round-turn estimate. Pass an empty feeMap (the
// CSV path) to always use the estimate.
export function matchFillsFlatToFlat(
  fills: MatchFill[],
  feeMap: Map<string, number>,
): ParsedTrade[] {
  const groups = new Map<string, MatchFill[]>()
  for (const f of fills) {
    const accountKey = f.accountId != null ? String(f.accountId) : 'unknown'
    const key = `${accountKey}_${f.contractName}_${f.date}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }

  const result: ParsedTrade[] = []

  for (const group of Array.from(groups.values())) {
    group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    const { instrument, date } = group[0]
    const brokerAccountId = group[0].accountId != null ? String(group[0].accountId) : null
    const pointValue = POINT_VALUES[instrument] ?? 50

    let pos = 0
    let side: 'long' | 'short' | null = null
    let entryQty = 0
    let entryNotional = 0
    let exitQty = 0
    let exitNotional = 0
    let feeAccum = 0
    let feesAllReal = true
    let firstFillId = ''
    let lastFillId = ''
    let entryTime = ''
    let exitTime = ''

    const reset = () => {
      side = null
      entryQty = 0
      entryNotional = 0
      exitQty = 0
      exitNotional = 0
      feeAccum = 0
      feesAllReal = true
      firstFillId = ''
      lastFillId = ''
      entryTime = ''
      exitTime = ''
    }

    const emit = () => {
      const qty = entryQty
      const entryPrice = entryNotional / entryQty
      const exitPrice = exitNotional / exitQty
      const pnl =
        (side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice) * pointValue * qty
      const commission = feesAllReal && feeAccum > 0 ? feeAccum : feeForContracts(instrument, qty)
      result.push({
        date,
        entry_time: new Date(entryTime).toISOString(),
        exit_time: new Date(exitTime).toISOString(),
        direction: side as 'long' | 'short',
        quantity: qty,
        entry_price: entryPrice,
        exit_price: exitPrice,
        gross_pnl: Math.round(pnl * 100) / 100,
        commission: Math.round(commission * 100) / 100,
        net_pnl: Math.round((pnl - commission) * 100) / 100,
        tradovate_order_id: `${firstFillId}_${lastFillId}`,
        instrument,
        pnl_raw: '',
        broker_account_id: brokerAccountId,
      })
    }

    for (const fill of group) {
      const signed = fill.action === 'Buy' ? 1 : -1
      const perUnitFee = feeMap.has(fill.id) ? feeMap.get(fill.id)! / fill.qty : null
      let q = fill.qty

      while (q > 0) {
        if (side === null) {
          side = signed > 0 ? 'long' : 'short'
          firstFillId = fill.id
          entryTime = fill.timestamp
        }
        const dir = side === 'long' ? 1 : -1

        if (signed === dir) {
          // adding to the position → entry side
          entryQty += q
          entryNotional += q * fill.price
          pos += signed * q
          if (perUnitFee === null) feesAllReal = false
          else feeAccum += perUnitFee * q
          q = 0
        } else {
          // reducing the position → exit side
          const take = Math.min(q, Math.abs(pos))
          exitQty += take
          exitNotional += take * fill.price
          pos += signed * take
          if (perUnitFee === null) feesAllReal = false
          else feeAccum += perUnitFee * take
          lastFillId = fill.id
          exitTime = fill.timestamp
          q -= take
          if (pos === 0) {
            emit()
            reset()
          }
        }
      }
    }
  }

  result.sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())
  return result
}

export function parseTradovateCSV(csvText: string): ParsedTrade[] {
  const result = Papa.parse<RawRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  })

  if (result.errors.length > 0) {
    console.warn('CSV parse warnings:', result.errors)
  }

  // Each Performance-CSV row is one matched buy+sell fill pair. Explode every
  // row back into its two underlying fills, then replay them through the shared
  // flat-to-flat matcher so a bracket order Tradovate exported as several
  // partial-fill rows collapses into a single round-turn trade — identical
  // grouping to the live API sync. Empty feeMap → round-turn fee estimate.
  const fills: MatchFill[] = []

  for (const row of result.data) {
    const symbol      = (row.symbol         ?? '').trim()
    const qtyRaw      = (row.qty            ?? '').trim()
    const buyPriceRaw = (row.buyPrice        ?? '').trim()
    const sellPriceRaw= (row.sellPrice       ?? '').trim()
    const boughtTs    = (row.boughtTimestamp ?? '').trim()
    const soldTs      = (row.soldTimestamp   ?? '').trim()
    const buyFillId   = (row.buyFillId       ?? '').trim()
    const sellFillId  = (row.sellFillId      ?? '').trim()
    // Tradovate Performance CSV column is usually "account" or "accountId".
    const accountRaw  = (row.account ?? row.accountId ?? row.accountName ?? '').trim()

    // Skip rows missing required fields
    if (!symbol || !qtyRaw || !buyPriceRaw || !sellPriceRaw || !boughtTs) continue

    const qty       = parseFloat(qtyRaw)
    const buyPrice  = parseFloat(buyPriceRaw)
    const sellPrice = parseFloat(sellPriceRaw)

    if (isNaN(qty) || isNaN(buyPrice) || isNaN(sellPrice) || qty <= 0) continue

    const instrument = extractInstrument(symbol)
    const accountId  = accountRaw || undefined

    const boughtDate = parseTimestamp(boughtTs)
    const soldDate   = soldTs ? parseTimestamp(soldTs) : boughtDate

    // The matcher derives direction from fill time order: for a short the sell
    // fill carries the earlier timestamp, so it opens the position first.
    fills.push({
      id: buyFillId,
      action: 'Buy',
      qty,
      price: buyPrice,
      timestamp: boughtDate.toISOString(),
      accountId,
      contractName: symbol,
      instrument,
      date: boughtDate.toISOString().split('T')[0],
    })
    fills.push({
      id: sellFillId,
      action: 'Sell',
      qty,
      price: sellPrice,
      timestamp: soldDate.toISOString(),
      accountId,
      contractName: symbol,
      instrument,
      date: soldDate.toISOString().split('T')[0],
    })
  }

  return matchFillsFlatToFlat(fills, new Map())
}
