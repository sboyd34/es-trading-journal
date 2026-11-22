import Papa from 'papaparse'
import { getTodayChicagoDateString } from '@/lib/eod-gate'

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

// Lives in lib/instruments.ts now — re-exported here so the server-side
// consumers that already pull the CSV/fill helpers from this module keep their
// existing import. Client components should import from lib/instruments
// directly: this file imports papaparse, and the table alone is not worth it.
export { POINT_VALUES } from './instruments'
import { POINT_VALUES } from './instruments'

// All-in round-turn fees per contract: broker commission + exchange + NFA + clearing.
// Single source of truth for ALL import paths — the CSV importer
// (app/api/trades/import) and the live API sync (app/api/tradovate/sync) both
// resolve fees through feeForContracts() below. Never re-declare these rates
// inside a route; a private copy in the CSV importer is exactly how the two
// paths drifted apart and started writing different commissions for the same
// trade depending on how it was ingested.
//
// ES & MES are reconciled against a real Tradovate Performance export
// (2026-07-30, 9 round turns): these rates reproduce Tradovate's reported net of
// $489.24 to the cent. The previously-stored ES 4.10 / MES 1.01 did NOT — they
// produce $479.81 — so treat those values as disproven, not merely stale.
//
// NQ & MNQ are UNVERIFIED estimates carried over from the old table. Reconcile
// them against a statement before trusting net P&L on those contracts.
export const ALLIN_FEE_PER_CONTRACT: Record<string, number> = {
  ES: 3.10,
  NQ: 3.47,
  MES: 1.04,
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

const CHICAGO_TZ = 'America/Chicago'

// Tradovate's CSV export timestamps are wall-clock time in the account's local
// (Central) timezone with no offset marker, so a naive `new Date(str)` parse
// silently treats them as server-local time (UTC on Vercel) — off by 5-6 hours
// depending on DST. This explicitly localizes to America/Chicago instead,
// using the same UTC-offset-diff trick as eod-gate.ts's makeChicagoTimeOnDate.
// MM/DD/YYYY HH:MM:SS (Central wall clock) → Date (correct UTC instant)
function parseTimestamp(ts: string): Date {
  const [datePart, timePart] = ts.trim().split(' ')
  const [month, day, year] = datePart.split('/').map((s) => parseInt(s, 10))
  const [hour, minute, second] = timePart.split(':').map((s) => parseInt(s, 10))

  const wallUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const chicagoWallString = new Date(wallUtc).toLocaleString('en-US', {
    timeZone: CHICAGO_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const match = chicagoWallString.match(
    /(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/,
  )
  if (!match) return new Date(wallUtc)
  const [, cm, cd, cy, ch, cmin, cs] = match
  const chicagoWallUtc = Date.UTC(
    parseInt(cy, 10),
    parseInt(cm, 10) - 1,
    parseInt(cd, 10),
    parseInt(ch, 10),
    parseInt(cmin, 10),
    parseInt(cs, 10),
  )
  const offsetMs = wallUtc - chicagoWallUtc
  return new Date(wallUtc + offsetMs)
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

// A (account, contract, date) group whose fills are not self-contained: the
// signed quantities do not sum to zero, so the stream either opened before the
// window or is still open at its end. netQty is the leftover signed position
// (positive = long carry, negative = short carry).
export interface FillImbalance {
  accountId: string | null
  contractName: string
  date: string
  netQty: number
  fillCount: number
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
//
// FLAT-START GUARD. The walk above is only valid if the group's first fill
// opens a position. When an export window opens mid-position, the first fill is
// really a CLOSE, gets read as an open, and every pairing downstream shifts by
// one — blending entries from price regimes hours apart into a single
// volume-weighted row. That produced a -$12,593.70 phantom (2 lots held 489
// minutes across a 4.5% crash day) in a real import, and the error is unbounded
// rather than a rounding drift.
//
// The detector is an invariant, not a heuristic: a self-contained flat-to-flat
// stream ALWAYS has signed quantities summing to zero, so a nonzero sum is proof
// the group is incomplete. It cannot tell WHICH end is truncated, though —
// started-non-flat and ended-non-flat look identical — so seeding a guessed
// carry position would just relocate the fabrication. We skip the group and
// report it instead; callers surface the imbalance so the window can be widened
// or the day re-exported.
export function matchFillsWithDiagnostics(
  fills: MatchFill[],
  feeMap: Map<string, number>,
): { trades: ParsedTrade[]; imbalances: FillImbalance[] } {
  const groups = new Map<string, MatchFill[]>()
  for (const f of fills) {
    const accountKey = f.accountId != null ? String(f.accountId) : 'unknown'
    const key = `${accountKey}_${f.contractName}_${f.date}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }

  const result: ParsedTrade[] = []
  const imbalances: FillImbalance[] = []

  for (const group of Array.from(groups.values())) {
    group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    const netQty = group.reduce((s, f) => s + (f.action === 'Buy' ? f.qty : -f.qty), 0)
    if (netQty !== 0) {
      imbalances.push({
        accountId: group[0].accountId != null ? String(group[0].accountId) : null,
        contractName: group[0].contractName,
        date: group[0].date,
        netQty,
        fillCount: group.length,
      })
      continue
    }

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

  // Warn here rather than at each call site so neither ingestion path can skip
  // a group silently — server logs for the API sync, browser console for CSV.
  if (imbalances.length > 0) {
    console.warn(
      `[tradovate] skipped ${imbalances.length} unbalanced fill group(s) — not flat-to-flat, ` +
        'the export window likely opened or closed mid-position:',
      imbalances.map((i) => `${i.contractName} ${i.date} net ${i.netQty > 0 ? '+' : ''}${i.netQty}`),
    )
  }

  return { trades: result, imbalances }
}

// Trades-only view for callers that don't yet surface imbalances.
export function matchFillsFlatToFlat(
  fills: MatchFill[],
  feeMap: Map<string, number>,
): ParsedTrade[] {
  return matchFillsWithDiagnostics(fills, feeMap).trades
}

// ── CSV round-turn merge predicate (Option B) ─────────────────────────────────
// Each Tradovate Performance-CSV row is ALREADY a matched round turn: Tradovate
// paired the fills and reported the P&L. Re-exploding rows into fills and
// re-pairing them in time order is what scrambles entries and exits across
// overlapping positions (a long's real exit becomes the next short's entry),
// which corrupts per-trade prices, direction, and win/loss — though never the
// total, since total gross = pv * SUM(sell notional - buy notional) regardless
// of pairing.
//
// So instead of re-pairing, we keep Tradovate's pairing and merge only rows
// that are provably the same underlying position (a bracket order that filled
// in several pieces). This predicate decides what "same position" means.
export interface CsvRoundTurn {
  direction: 'long' | 'short'
  qty: number
  entryPrice: number
  exitPrice: number
  entryTime: Date
  exitTime: Date
  entryFillId: string
  exitFillId: string
  contractName: string
  instrument: string
  accountId?: string
}

// Two round turns are ONE journal trade exactly when the account was never flat
// between them. That is the same flat-to-flat definition the API path uses, just
// applied to Tradovate's own pairing instead of to re-exploded fills:
//
//   - same direction — opposite directions can never be one position, and
//     merging across them is precisely what produced the scramble.
//   - `next` opens before `prev` closes — if next's entry precedes prev's exit,
//     position never returned to zero in between, so the two rows are pieces of
//     one position (a bracket that filled in several parts).
//
// Deliberately NO time-gap constant. An overlap test is provable from the
// timestamps; a "within N seconds" threshold is a guess that silently fuses two
// genuine setups into one blended row with an off-tick average price. If `next`
// starts after `prev` exits, the position went flat — that is two trades, even
// if the re-entry came three seconds later.
//
// `prev` may already be a merge of earlier rows, in which case its exitTime is
// the latest exit so far, which makes the chaining transitive.
export function shouldMergeRoundTurns(prev: CsvRoundTurn, next: CsvRoundTurn): boolean {
  if (prev.direction !== next.direction) return false
  if (prev.contractName !== next.contractName) return false
  if (prev.accountId !== next.accountId) return false
  return next.entryTime.getTime() < prev.exitTime.getTime()
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

  // Each Performance-CSV row is one matched buy+sell fill pair — Tradovate has
  // ALREADY paired the fills. Keep that pairing: read each row as a round turn
  // and fold only rows that provably belong to the same position (see
  // shouldMergeRoundTurns). The old path exploded rows back into fills and
  // re-paired them in time order, which let a long's real exit become the next
  // short's entry whenever two positions overlapped.
  const roundTurns: CsvRoundTurn[] = []

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

    // Direction comes from which leg opened the position: bought first = long,
    // sold first = short. Ties (and a missing soldTimestamp) read as long,
    // matching the old fill-replay behaviour.
    const isLong = boughtDate.getTime() <= soldDate.getTime()

    roundTurns.push({
      direction: isLong ? 'long' : 'short',
      qty,
      entryPrice: isLong ? buyPrice : sellPrice,
      exitPrice: isLong ? sellPrice : buyPrice,
      entryTime: isLong ? boughtDate : soldDate,
      exitTime: isLong ? soldDate : boughtDate,
      entryFillId: isLong ? buyFillId : sellFillId,
      exitFillId: isLong ? sellFillId : buyFillId,
      contractName: symbol,
      instrument,
      accountId,
    })
  }

  // Fold within (account, contract, date) groups — the same grouping the API
  // path uses. Folding one globally time-sorted list instead would let an
  // interleaved row from another contract sit between two pieces of the same
  // bracket and block their merge.
  const groups = new Map<string, CsvRoundTurn[]>()
  for (const rt of roundTurns) {
    const key = `${rt.accountId ?? 'unknown'}_${rt.contractName}_${getTodayChicagoDateString(rt.entryTime)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(rt)
  }

  // Prices are notional-weighted, so a 3-piece bracket entry reports one
  // blended entry price exactly as the flat-to-flat matcher did.
  const merged: CsvRoundTurn[] = []
  for (const group of Array.from(groups.values())) {
    group.sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime())

    let open: CsvRoundTurn | null = null
    for (const rt of group) {
      if (open && shouldMergeRoundTurns(open, rt)) {
        const qty = open.qty + rt.qty
        open.entryPrice = (open.entryPrice * open.qty + rt.entryPrice * rt.qty) / qty
        open.exitPrice = (open.exitPrice * open.qty + rt.exitPrice * rt.qty) / qty
        open.qty = qty
        if (rt.exitTime.getTime() > open.exitTime.getTime()) {
          open.exitTime = rt.exitTime
          open.exitFillId = rt.exitFillId
        }
        continue
      }
      open = { ...rt }
      merged.push(open)
    }
  }

  merged.sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime())

  return merged.map((rt) => {
    const pointValue = POINT_VALUES[rt.instrument] ?? 50
    const pnl =
      (rt.direction === 'long'
        ? rt.exitPrice - rt.entryPrice
        : rt.entryPrice - rt.exitPrice) *
      pointValue *
      rt.qty
    const commission = feeForContracts(rt.instrument, rt.qty)
    return {
      date: getTodayChicagoDateString(rt.entryTime),
      entry_time: rt.entryTime.toISOString(),
      exit_time: rt.exitTime.toISOString(),
      direction: rt.direction,
      quantity: rt.qty,
      entry_price: rt.entryPrice,
      exit_price: rt.exitPrice,
      gross_pnl: Math.round(pnl * 100) / 100,
      commission: Math.round(commission * 100) / 100,
      net_pnl: Math.round((pnl - commission) * 100) / 100,
      tradovate_order_id: `${rt.entryFillId}_${rt.exitFillId}`,
      instrument: rt.instrument,
      pnl_raw: '',
      broker_account_id: rt.accountId ?? null,
    }
  })
}
