# Position Sizing Calculator — Design Spec
**Date:** 2026-05-22
**Status:** Approved

---

## Problem

Before every trade, sizing requires mental math: stop distance × point value = risk/contract → how many contracts fit within the soft stop. This is done incorrectly under pressure. A calculator that reads account rules and computes live removes that error.

---

## Scope

- New `PositionSizer` collapsible card on the pre-market page, above the morning brief
- New `components/pre-market/PositionSizer.tsx` — self-contained client component
- New `lib/apex-config.ts` — extracts `APEX_CONFIGS` and types from `ApexClient.tsx` so both files can share them without duplication
- Loads user's `apex_accounts` from Supabase on mount; falls back to manual selectors if no accounts exist
- Live result computation via `useMemo` — no button, no API calls
- No new API routes, no new DB columns, no new npm dependencies

---

## Architecture

### New file: `lib/apex-config.ts`

Extracts the shared constants from `ApexClient.tsx` so `PositionSizer` can import them:

```ts
export const APEX_CONFIGS = {
  25000:  { profitTarget: 1500,  trailingDrawdown: 1000, dll: 500,  maxContracts: 4  },
  50000:  { profitTarget: 3000,  trailingDrawdown: 2000, dll: 1000, maxContracts: 6  },
  100000: { profitTarget: 6000,  trailingDrawdown: 3000, dll: 1500, maxContracts: 8  },
  150000: { profitTarget: 9000,  trailingDrawdown: 4000, dll: 2000, maxContracts: 12 },
} as const

export type AccountSize = keyof typeof APEX_CONFIGS
export const ACCOUNT_SIZES = [25000, 50000, 100000, 150000] as const satisfies readonly AccountSize[]

// Eval and PA soft/hard stop constants (from trading system rules)
export const RISK_RULES = {
  evaluation: { softStop: 150, hardStop: 250 },
  pa:         { softStop: 120, hardStop: 150 },
} as const
```

`ApexClient.tsx` is updated to import from `lib/apex-config.ts` instead of defining its own constants.

### New file: `components/pre-market/PositionSizer.tsx`

Client component. No props — fully self-contained.

**Internal state:**
- `open: boolean` — collapsed/expanded toggle, default `false`
- `accounts: ApexAccount[]` — loaded from Supabase on mount
- `selectedAccountId: string | null` — selected from dropdown
- `manualSize: AccountSize` — fallback when no accounts, default `50000`
- `manualMode: 'evaluation' | 'pa'` — fallback mode, default `'evaluation'`
- `instrument: 'ES' | 'MES' | 'NQ' | 'MNQ'` — default `'ES'`
- `entryPrice: string` — controlled input
- `stopPrice: string` — controlled input

**`useMemo` — `result`:** Computes sizing from current state. Returns `null` if entry or stop is empty/invalid.

```ts
type SizerResult = {
  stopPoints: number
  riskPerContract: number
  softContracts: number    // floor(softStop / riskPerContract), capped at maxContracts
  hardContracts: number    // floor(hardStop / riskPerContract), capped at maxContracts
  maxContracts: number
  totalRiskSoft: number
  softStop: number
  hardStop: number
  tooWide: boolean         // softContracts === 0
}
```

Computation:
```ts
const stopPoints = Math.abs(parseFloat(entryPrice) - parseFloat(stopPrice))
const pointValue = POINT_VALUES[instrument]  // from lib/tradovate-parser.ts
const riskPerContract = stopPoints * pointValue
const softContracts = Math.min(maxContracts, Math.floor(softStop / riskPerContract))
const hardContracts = Math.min(maxContracts, Math.floor(hardStop / riskPerContract))
const tooWide = softContracts === 0
```

### Modified file: `app/(app)/pre-market/page.tsx`

Import and render `PositionSizer` as the first card inside the `space-y-6` container, above `MarketStateCard`:

```tsx
import PositionSizer from '@/components/pre-market/PositionSizer'

// In JSX, before <MarketStateCard>:
<PositionSizer />
```

---

## Components

### Collapsed State

```
[+]  Position Sizing   ·   50K Eval
```

Single row: chevron toggle, "Position Sizing" label, account name pill. Click anywhere on the header to expand.

### Expanded State

**Inputs row:**

| Field | Type | Options |
|---|---|---|
| Account | Dropdown | User's `apex_accounts` (name · size · mode); if none: manual size + mode selectors |
| Instrument | Button group | ES · MES · NQ · MNQ |
| Entry | Number input | Decimal, e.g. `5100.25` |
| Stop | Number input | Decimal, e.g. `5097.75` |

**Results (only rendered when both entry and stop are valid numbers with stopPoints > 0):**

```
Stop: 2.5 pts  ·  Risk/contract: $125.00

Soft stop ($150)  →  1 ES    (max 6)   ← emerald if ≥1, red if 0
Hard stop ($250)  →  2 ES    (max 6)   ← gray secondary line

Total risk (soft): $125.00
```

Color states for the soft stop line:
- Emerald: `softContracts >= 1` and `softContracts < maxContracts`
- Amber: `softContracts === maxContracts` (at the limit)
- Red + warning: `softContracts === 0` → show "Stop too wide — reduce stop or switch to MES"

---

## Data Flow

```
PositionSizer (mounts on pre-market page)
  ├─> useEffect → fetch apex_accounts → setAccounts
  ├─> selectedAccount resolves → config (size, mode, maxContracts)
  ├─> instrument → pointValue (from POINT_VALUES)
  ├─> entryPrice + stopPrice → useMemo result
  └─> JSX renders result inline (no save, no API call)
```

---

## `ApexAccount` type reference

From `types/index.ts` — the existing type used by `ApexClient`. Fields used by `PositionSizer`: `id`, `name`, `account_size`, `mode`.

---

## Constraints

- No new API routes — Supabase client query only
- No new DB columns
- No new npm dependencies
- `APEX_CONFIGS` and `RISK_RULES` extracted to `lib/apex-config.ts` — `ApexClient.tsx` imports from there (no behavior change, just deduplication)
- Falls back to manual size/mode selectors if user has no `apex_accounts` rows
- Results render only when both inputs are valid — no error states needed for empty fields
- `tooWide = true` when even 1 contract at soft stop would exceed the stop — show a clear message rather than "0 contracts"
