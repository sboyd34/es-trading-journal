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

// "$25.00" → 25, "$(35.00)" → -35
function parsePnl(pnl: string): number {
  const cleaned = pnl.trim().replace(/[$,]/g, '')
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    return -parseFloat(cleaned.slice(1, -1))
  }
  return parseFloat(cleaned)
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

export function parseTradovateCSV(csvText: string): ParsedTrade[] {
  const result = Papa.parse<RawRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  })

  if (result.errors.length > 0) {
    console.warn('CSV parse warnings:', result.errors)
  }

  const trades: ParsedTrade[] = []

  for (const row of result.data) {
    const symbol      = (row.symbol         ?? '').trim()
    const qtyRaw      = (row.qty            ?? '').trim()
    const buyPriceRaw = (row.buyPrice        ?? '').trim()
    const sellPriceRaw= (row.sellPrice       ?? '').trim()
    const pnlRaw      = (row.pnl            ?? '').trim()
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

    // Direction determined by timestamp order, not price comparison:
    // soldTimestamp < boughtTimestamp → sold to open (short), bought to close
    // boughtTimestamp < soldTimestamp → bought to open (long), sold to close
    const boughtDate = parseTimestamp(boughtTs)
    const soldDate   = soldTs ? parseTimestamp(soldTs) : boughtDate

    const direction: 'long' | 'short' = soldDate < boughtDate ? 'short' : 'long'
    const entryPrice = direction === 'long' ? buyPrice  : sellPrice
    const exitPrice  = direction === 'long' ? sellPrice : buyPrice

    const grossPnl = parsePnl(pnlRaw)
    const commission = feeForContracts(instrument, qty)
    const netPnl     = Math.round((grossPnl - commission) * 100) / 100

    trades.push({
      date:               boughtDate.toISOString().split('T')[0],
      entry_time:         boughtDate.toISOString(),
      exit_time:          soldDate.toISOString(),
      direction,
      quantity:           qty,
      entry_price:        entryPrice,
      exit_price:         exitPrice,
      gross_pnl:          Math.round(grossPnl * 100) / 100,
      commission,
      net_pnl:            netPnl,
      tradovate_order_id: `${buyFillId}_${sellFillId}`,
      instrument,
      pnl_raw:            pnlRaw,
      broker_account_id:  accountRaw || null,
    })
  }

  // Chronological order
  trades.sort(
    (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
  )

  return trades
}
