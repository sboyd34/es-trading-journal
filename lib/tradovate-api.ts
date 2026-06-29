import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { POINT_VALUES, feeForContracts } from './tradovate-parser'
import type { ParsedTrade } from './tradovate-parser'

const BASE_URL = 'https://live.tradovateapi.com/v1'

// ── Encryption ───────────────────────────────────────────────────────────────

function encKey(): Buffer {
  const k = process.env.TRADOVATE_ENCRYPTION_KEY
  if (!k || k.length !== 64) throw new Error('TRADOVATE_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)')
  return Buffer.from(k, 'hex')
}

export function encryptPassword(pw: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', encKey(), iv)
  const enc = Buffer.concat([cipher.update(pw, 'utf8'), cipher.final()])
  return `${iv.toString('hex')}:${enc.toString('hex')}`
}

export function decryptPassword(enc: string): string {
  const [ivHex, dataHex] = enc.split(':')
  const decipher = createDecipheriv('aes-256-cbc', encKey(), Buffer.from(ivHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

// ── Auth ─────────────────────────────────────────────────────────────────────

interface AuthResponse {
  accessToken?: string
  expirationTime?: string
  p?: string
  d?: string
  errorText?: string
}

export async function authenticate(
  username: string,
  password: string,
): Promise<{ accessToken: string; expirationTime: string }> {
  const res = await fetch(`${BASE_URL}/auth/accesstokenrequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      name: username,
      password,
      appId: 'Sample App',
      appVersion: '1.0',
      cid: 0,
      sec: '',
    }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Tradovate auth ${res.status}: ${errBody || res.statusText}`)
  }

  const data: AuthResponse = await res.json()
if (!data.accessToken) {
    const detail = data.errorText ?? data.d ?? data.p ?? ''
    throw new Error(detail || 'Authentication failed — check credentials')
  }

  return {
    accessToken: data.accessToken,
    expirationTime: data.expirationTime ?? new Date(Date.now() + 86_400_000).toISOString(),
  }
}

// ── Fills → Trades ────────────────────────────────────────────────────────────

interface Fill {
  id: number
  orderId: number
  contractId: number
  accountId?: number
  timestamp: string
  tradeDate: { year: number; month: number; day: number }
  action: 'Buy' | 'Sell'
  qty: number
  price: number
}

// ── Fill fees ────────────────────────────────────────────────────────────────
// Tradovate records each fill's fees as a FillFee whose id equals the fill id.
// Summing every component yields the true all-in cost Tradovate billed, which we
// use instead of the per-contract estimate so journal net_pnl matches the
// statement. See https://partner.tradovate.com/api/rest-api-endpoints/orders/fill-fee-list

interface FillFee {
  id: number
  clearingFee?: number
  exchangeFee?: number
  nfaFee?: number
  brokerageFee?: number
  ipFee?: number
  commission?: number
  orderRoutingFee?: number
}

function allInFee(f: FillFee): number {
  return (
    (f.commission ?? 0) +
    (f.clearingFee ?? 0) +
    (f.exchangeFee ?? 0) +
    (f.nfaFee ?? 0) +
    (f.brokerageFee ?? 0) +
    (f.ipFee ?? 0) +
    (f.orderRoutingFee ?? 0)
  )
}

// Map of fillId → all-in fee. Best-effort: any failure returns an empty map and
// the matcher falls back to ALLIN_FEE_PER_CONTRACT estimates per fill.
async function fetchFillFees(token: string): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  try {
    const res = await fetch(`${BASE_URL}/fillFee/list`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return map
    const fees: FillFee[] = await res.json()
    for (const fee of fees) map.set(fee.id, allInFee(fee))
  } catch {
    // best-effort — estimates fill the gap
  }
  return map
}

const contractNameCache = new Map<number, string>()

async function resolveContractName(contractId: number, token: string): Promise<string> {
  if (contractNameCache.has(contractId)) return contractNameCache.get(contractId)!
  try {
    const res = await fetch(`${BASE_URL}/contract/item?id=${contractId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const name = res.ok ? ((await res.json()).name ?? 'ES') : 'ES'
    contractNameCache.set(contractId, name)
    return name
  } catch {
    return 'ES'
  }
}

const INSTRUMENT_PREFIXES = ['MES', 'MNQ', 'RTY', 'YM', 'NQ', 'ES', 'GC', 'CL']

function extractInstrument(name: string): string {
  const up = name.toUpperCase()
  for (const p of INSTRUMENT_PREFIXES) {
    if (up.startsWith(p)) return p
  }
  return 'ES'
}

export interface MatchFill {
  id: number
  action: 'Buy' | 'Sell'
  qty: number
  price: number
  timestamp: string
  accountId?: number
  contractName: string
  instrument: string
  date: string
}

// Flat-to-flat matcher. Within each (account, contract, date) bucket, walk fills
// in time order tracking signed net position. Every time the position returns to
// flat, emit exactly one round-turn trade — so a bracket order that fills in N
// pieces and exits in M pieces becomes a single journal row. A fill that
// overshoots flat (a position flip) is split: the portion that reaches flat
// closes the current trade, the remainder opens the next one. Commission is the
// summed real per-fill fee for every fill portion in the lifecycle; if any fill
// lacks a real fee, the whole trade falls back to the round-turn estimate.
export function matchFillsFlatToFlat(
  fills: MatchFill[],
  feeMap: Map<number, number>,
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
    let firstFillId = 0
    let lastFillId = 0
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
      firstFillId = 0
      lastFillId = 0
      entryTime = ''
      exitTime = ''
    }

    const emit = () => {
      const qty = entryQty
      const entryPrice = entryNotional / entryQty
      const exitPrice = exitNotional / exitQty
      const pnl =
        (side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice) * pointValue * qty
      const commission = feesAllReal ? feeAccum : feeForContracts(instrument, qty)
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

export async function fetchAndMatchTrades(token: string): Promise<ParsedTrade[]> {
  const res = await fetch(`${BASE_URL}/fill/list`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Tradovate fill fetch failed: ${res.status}`)
  const fills: Fill[] = await res.json()
  if (!fills.length) return []

  // Resolve all contract names in parallel
  const uniqueIds = Array.from(new Set(fills.map((f) => f.contractId)))
  const nameMap = new Map<number, string>()
  await Promise.all(uniqueIds.map(async (id) => nameMap.set(id, await resolveContractName(id, token))))

  // Real all-in fees per fill (best-effort; empty map → estimate fallback)
  const feeMap = await fetchFillFees(token)

  const matchFills: MatchFill[] = []
  for (const fill of fills) {
    const contractName = nameMap.get(fill.contractId) ?? 'ES'
    const instrument = extractInstrument(contractName)
    if (!(instrument in POINT_VALUES)) continue
    const td = fill.tradeDate
    const date = `${td.year}-${String(td.month).padStart(2, '0')}-${String(td.day).padStart(2, '0')}`
    matchFills.push({
      id: fill.id,
      action: fill.action,
      qty: fill.qty,
      price: fill.price,
      timestamp: fill.timestamp,
      accountId: fill.accountId,
      contractName,
      instrument,
      date,
    })
  }

  return matchFillsFlatToFlat(matchFills, feeMap)
}
