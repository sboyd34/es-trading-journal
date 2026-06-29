import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { POINT_VALUES, matchFillsFlatToFlat } from './tradovate-parser'
import type { ParsedTrade, MatchFill } from './tradovate-parser'

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
async function fetchFillFees(token: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const res = await fetch(`${BASE_URL}/fillFee/list`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return map
    const fees: FillFee[] = await res.json()
    for (const fee of fees) map.set(String(fee.id), allInFee(fee))
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
      id: String(fill.id),
      action: fill.action,
      qty: fill.qty,
      price: fill.price,
      timestamp: fill.timestamp,
      accountId: fill.accountId != null ? String(fill.accountId) : undefined,
      contractName,
      instrument,
      date,
    })
  }

  return matchFillsFlatToFlat(matchFills, feeMap)
}
