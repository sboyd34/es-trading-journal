import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { POINT_VALUES } from './tradovate-parser'
import type { ParsedTrade } from './tradovate-parser'

const BASE_URL = 'https://demo.tradovateapi.com/v1'
const COMMISSION_PER_CONTRACT = 4.10

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
  if (!data.accessToken) throw new Error(data.d ?? data.p ?? 'Authentication failed — check credentials')

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

  // Group fills by (accountId, contractName, date) so fills from different
  // accounts don't FIFO-match each other.
  type RichFill = Fill & { instrument: string; date: string }
  const groups = new Map<string, RichFill[]>()

  for (const fill of fills) {
    const contractName = nameMap.get(fill.contractId) ?? 'ES'
    const instrument = extractInstrument(contractName)
    if (!(instrument in POINT_VALUES)) continue
    const td = fill.tradeDate
    const date = `${td.year}-${String(td.month).padStart(2, '0')}-${String(td.day).padStart(2, '0')}`
    const accountKey = fill.accountId != null ? String(fill.accountId) : 'unknown'
    const key = `${accountKey}_${contractName}_${date}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push({ ...fill, instrument, date })
  }

  const result: ParsedTrade[] = []

  for (const group of Array.from(groups.values())) {
    const { instrument, date } = group[0]
    const brokerAccountId = group[0].accountId != null ? String(group[0].accountId) : null
    const pointValue = POINT_VALUES[instrument] ?? 50

    group.sort((a: RichFill, b: RichFill) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    type OpenPos = { side: 'long' | 'short'; qty: number; price: number; time: Date; fillId: number }
    const open: OpenPos[] = []

    for (const fill of group) {
      const dt = new Date(fill.timestamp)
      const isBuy = fill.action === 'Buy'
      let remaining = fill.qty

      while (remaining > 0 && open.length > 0) {
        const top = open[0]
        const closing = (isBuy && top.side === 'short') || (!isBuy && top.side === 'long')
        if (!closing) break
        const qty = Math.min(remaining, top.qty)
        remaining -= qty
        top.qty -= qty

        const pnl = (top.side === 'long' ? fill.price - top.price : top.price - fill.price) * pointValue * qty
        const commission = qty * COMMISSION_PER_CONTRACT

        result.push({
          date,
          entry_time: top.time.toISOString(),
          exit_time: dt.toISOString(),
          direction: top.side,
          quantity: qty,
          entry_price: top.price,
          exit_price: fill.price,
          gross_pnl: Math.round(pnl * 100) / 100,
          commission: Math.round(commission * 100) / 100,
          net_pnl: Math.round((pnl - commission) * 100) / 100,
          tradovate_order_id: `fill_${top.fillId}_${fill.id}`,
          instrument,
          pnl_raw: '',
          broker_account_id: brokerAccountId,
        })

        if (top.qty === 0) open.shift()
      }

      if (remaining > 0) {
        open.push({ side: isBuy ? 'long' : 'short', qty: remaining, price: fill.price, time: dt, fillId: fill.id })
      }
    }
  }

  result.sort((a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime())
  return result
}
