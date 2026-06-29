# Tradovate Flat-to-Flat Grouping + Real Commissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tradovate API sync emit one journal row per round-turn position (flat → flat), with commissions taken from Tradovate's real per-fill `FillFee` records instead of per-contract estimates.

**Architecture:** Replace the per-fill FIFO matcher inside `fetchAndMatchTrades` with a pure, testable `matchFillsFlatToFlat` function. It walks fills per `(account, contract, date)` in time order tracking signed net position; every return to flat emits exactly one trade. Fills that overshoot flat (position flips) are split — the part reaching flat closes the trade, the remainder opens the next. Commission per trade = sum of real all-in fees for every fill (portion) in that lifecycle, falling back to the round-turn estimate only when a fill lacks a real fee.

**Tech Stack:** TypeScript, Next.js 14 server route helpers, Supabase (Postgres generated columns for `gross_pnl`/`net_pnl`), Tradovate REST (`/fill/list`, `/fillFee/list`).

---

## Context the implementer needs

- **Only one file changes:** `lib/tradovate-api.ts`. Both the on-demand sync (`app/api/tradovate/sync/route.ts`) and the cron sync (`app/api/tradovate/cron/route.ts`) call `fetchAndMatchTrades`, so they inherit the fix with zero edits.
- **Do NOT compute `gross_pnl`/`net_pnl` into the DB.** They are Postgres *generated columns* (`gross_pnl`, `net_pnl`) derived from `entry_price`, `exit_price`, `quantity`, `instrument`. The insert routes already omit them. `ParsedTrade` still carries them (the interface requires it) but they are informational on the API path. What the routes DO insert and what therefore matters: `entry_price`, `exit_price`, `quantity`, `direction`, `instrument`, `commission`, `tradovate_order_id`, dates.
- **`commission` IS inserted** by both routes — so the real-fee number computed here is what drives the Postgres `net_pnl`.
- **Current broken state:** the working tree already has `fetchFillFees`/`FillFee`/`allInFee` added (correct, keep them), but the import line was switched to `ALLIN_FEE_PER_CONTRACT` while line ~214 still calls `feeForContracts` — so the file does **not compile** right now. Task 1 fixes that.
- **No test runner exists** in this repo (CLAUDE.md: "No tests yet — manual UI verification"). We add ONE lightweight standalone verification script run via `npx tsx`; the production gate stays `npm run build`. This is a deliberate deviation from the writing-plans TDD default because the user's documented convention (build-gated, manual QA) takes precedence, and the tricky logic (flip-through-zero, fee allocation) still deserves crafted-input evidence.
- **Dedup key changes format** from `fill_<a>_<b>` to `<firstFillId>_<lastFillId>`. Consequence: a re-sync will NOT recognize previously-imported (mis-grouped) rows as duplicates. Task 5 is the one-time data migration to reconcile this — it is **manual and destructive**, run by Shawn, not the implementer.

---

## File Structure

- **Modify:** `lib/tradovate-api.ts`
  - Fix import (restore `feeForContracts`).
  - Add exported `MatchFill` interface + exported pure `matchFillsFlatToFlat(fills, feeMap)`.
  - Rewrite `fetchAndMatchTrades` body to: fetch fills → resolve names → `fetchFillFees` → build `MatchFill[]` → delegate to `matchFillsFlatToFlat`.
  - Delete the old per-fill FIFO loop and its `OpenPos`/`RichFill` types.
- **Create:** `scripts/verify-matcher.ts` — standalone assertions over crafted fills.

---

### Task 1: Restore compile — fix the import and wire the fee map

**Files:**
- Modify: `lib/tradovate-api.ts:2` (import line)
- Modify: `lib/tradovate-api.ts` (`fetchAndMatchTrades`, add `fetchFillFees` call)

- [ ] **Step 1: Fix the import**

Replace line 2:

```ts
import { POINT_VALUES, ALLIN_FEE_PER_CONTRACT } from './tradovate-parser'
```

with:

```ts
import { POINT_VALUES, feeForContracts } from './tradovate-parser'
```

(`ALLIN_FEE_PER_CONTRACT` is referenced only in the `fetchFillFees` comment, not in code; `feeForContracts` is the estimate fallback the matcher needs.)

- [ ] **Step 2: Verify it now fails only where expected**

Run: `npx tsc --noEmit`
Expected: errors about the OLD matcher body (e.g., `RichFill`, `OpenPos`, `feeForContracts` usage is now fine) — Task 2 replaces that body. Do not chase these yet; they disappear in Task 2.

---

### Task 2: Add the pure flat-to-flat matcher and delegate to it

**Files:**
- Modify: `lib/tradovate-api.ts` — add `MatchFill` + `matchFillsFlatToFlat` above `fetchAndMatchTrades`; rewrite `fetchAndMatchTrades`; remove old `RichFill`/`OpenPos` types and the old grouping+FIFO loop.

- [ ] **Step 1: Add the `MatchFill` interface and the pure matcher**

Insert this block immediately above `export async function fetchAndMatchTrades`:

```ts
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
```

- [ ] **Step 2: Replace the `fetchAndMatchTrades` body**

Replace the entire current `fetchAndMatchTrades` function (from `export async function fetchAndMatchTrades` through its closing brace, including the old `RichFill` type, the `groups` map, and the FIFO `for` loop) with:

```ts
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
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If `RichFill`/`OpenPos` "declared but never used" errors appear, you missed deleting the old type declarations — remove them.

---

### Task 3: Standalone verification of the matcher logic

**Files:**
- Create: `scripts/verify-matcher.ts`

- [ ] **Step 1: Write the verification script**

```ts
import { matchFillsFlatToFlat, type MatchFill } from '../lib/tradovate-api'

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

const base = { contractName: 'ESM6', instrument: 'ES', date: '2026-06-16', accountId: 1 }
const ts = (s: string) => `2026-06-16T${s}Z`

// Scenario 1 — bracket entry fills in 2 pieces, exits once → ONE row.
{
  const fills: MatchFill[] = [
    { ...base, id: 1, action: 'Buy', qty: 2, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: 2, action: 'Buy', qty: 1, price: 5001, timestamp: ts('14:30:01') },
    { ...base, id: 3, action: 'Sell', qty: 3, price: 5010, timestamp: ts('14:35:00') },
  ]
  const feeMap = new Map<number, number>([[1, 2.0], [2, 1.0], [3, 3.0]])
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
    { ...base, id: 10, action: 'Buy', qty: 3, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: 11, action: 'Sell', qty: 2, price: 5010, timestamp: ts('14:35:00') },
    { ...base, id: 12, action: 'Sell', qty: 1, price: 5008, timestamp: ts('14:36:00') },
  ]
  const feeMap = new Map<number, number>([[10, 3.0], [11, 2.0], [12, 1.0]])
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
    { ...base, id: 20, action: 'Buy', qty: 2, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: 21, action: 'Sell', qty: 3, price: 5010, timestamp: ts('14:35:00') },
    { ...base, id: 22, action: 'Buy', qty: 1, price: 5005, timestamp: ts('14:40:00') },
  ]
  // id21 fee 3.0 over qty 3 → 1.0/contract: 2.0 to the long close, 1.0 to the short open.
  const feeMap = new Map<number, number>([[20, 2.0], [21, 3.0], [22, 1.0]])
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
    { ...base, id: 30, action: 'Buy', qty: 1, price: 5000, timestamp: ts('14:30:00') },
    { ...base, id: 31, action: 'Sell', qty: 1, price: 5010, timestamp: ts('14:35:00') },
  ]
  const feeMap = new Map<number, number>([[30, 2.05]]) // id31 missing
  const t = matchFillsFlatToFlat(fills, feeMap)
  check('S4 count', t.length, 1)
  check('S4 commission (estimate)', t[0].commission, 4.1)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/verify-matcher.ts`
Expected: every line `PASS`, final line `ALL PASS`, exit 0.
(If `tsx` is not installed, `npx` will fetch it on first run. Alternative: `npx ts-node scripts/verify-matcher.ts`.)

- [ ] **Step 3: If any scenario FAILs, fix `matchFillsFlatToFlat`, not the test**

The expected values above are hand-computed from the flat-to-flat + proportional-fee spec. A mismatch means the implementation diverged — re-read Task 2 Step 1.

---

### Task 4: Production gate — full build

**Files:** none (verification only)

- [ ] **Step 1: Run the gating build**

Run: `npm run build`
Expected: PASS — this runs lint + type-check + compile, exactly what Vercel runs. `npx tsc --noEmit` alone is not sufficient (it skips ESLint). Do not push until this is green.

- [ ] **Step 2: Commit**

```bash
git add lib/tradovate-api.ts scripts/verify-matcher.ts
git commit -m "$(cat <<'EOF'
Tradovate sync: group fills flat-to-flat with real per-fill commissions

A bracket order that fills/exits in multiple pieces previously produced one
journal row per fill. Replace the per-fill FIFO matcher with a flat-to-flat
walk: one round-turn trade per return to flat position, with entry/exit at
quantity-weighted average price. Commission now sums Tradovate's real FillFee
records (proportionally split on position flips), falling back to the
round-turn estimate only when a fill's fee is unavailable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: One-time data reconciliation (MANUAL — run by Shawn, not the implementer)

> ⚠️ Destructive and account-specific. Do not run automatically. This deletes existing Tradovate-synced rows so they can be re-imported under the new grouping. **It also drops any notes/narratives/mood/tags attached to those synced rows.** Decide scope before running.

**Why this is needed:** the dedup key format changed (`fill_a_b` → `firstFillId_lastFillId`), so a plain re-sync would create new correct rows *alongside* the old mis-grouped ones. You must remove the old synced rows first.

- [ ] **Step 1: Preview what will be deleted** (Supabase SQL editor)

```sql
SELECT date, instrument, COUNT(*) AS rows, SUM(quantity) AS contracts
FROM trades
WHERE user_id = '<your-user-id>'
  AND tradovate_order_id IS NOT NULL
GROUP BY date, instrument
ORDER BY date DESC;
```

- [ ] **Step 2: (Optional) Narrow the scope** — if you only want to re-import recent/suspect dates, add `AND date >= '<start>'` to both the preview and the delete, so older curated rows keep their narratives.

- [ ] **Step 3: Delete the synced rows**

```sql
DELETE FROM trades
WHERE user_id = '<your-user-id>'
  AND tradovate_order_id IS NOT NULL;
-- add the same AND date >= '<start>' here if you scoped Step 2
```

- [ ] **Step 4: Re-sync** — trigger `POST /api/tradovate/sync` (the in-app "Sync" action). New rows arrive grouped flat-to-flat with real commissions.

- [ ] **Step 5: Reconcile against a Tradovate statement**

```sql
SELECT COUNT(*) AS trades,
       ROUND(SUM(gross_pnl)::numeric, 2)  AS sum_gross,
       ROUND(SUM(commission)::numeric, 2) AS sum_commission,
       ROUND(SUM(net_pnl)::numeric, 2)    AS sum_net
FROM trades
WHERE user_id = '<your-user-id>' AND tradovate_order_id IS NOT NULL;
```
Expected: `sum_net` matches Tradovate's reported net for the same window (to the penny, since commissions are now the billed fees).

**Note on `restamp_commissions.sql`:** that estimate-based re-stamp is *superseded* for any rows you re-import here (they now carry real fees). Keep it only for legacy rows you choose NOT to re-import.

---

## Self-Review

- **Spec coverage:**
  - "Bracket order = one entry, not one per contract" → Task 2 flat-to-flat walk (Scenarios 1 & 2 prove single-row grouping). ✓
  - "Fix commissions" → real `FillFee` summation wired in Task 1 + Task 2; fallback in `emit()`; Scenario 4 proves fallback. ✓
  - Broken compile state → Task 1. ✓
  - Dedup/re-import consequence → Task 5. ✓
- **Placeholder scan:** none — every code step is complete; expected values are concrete and hand-computed.
- **Type consistency:** `MatchFill` fields used identically in `matchFillsFlatToFlat`, `fetchAndMatchTrades`, and `verify-matcher.ts`. `matchFillsFlatToFlat(fills, feeMap)` signature matches both call sites. `ParsedTrade` fields match the existing interface in `lib/tradovate-parser.ts`.
- **Known limitation (intentional, not fixed here):** positions held across midnight are split by the `(account, contract, date)` bucket and won't form a closed trade — pre-existing behavior of date-grouping, unchanged. Out of scope.
