// Apex account parameters. The 25K and 50K rows are the LEGACY evaluation
// rules — the trader's live accounts — per ~/Downloads/trading_plan_apex_50k.pdf
// and Apex's legacy help-center page: intraday trailing drawdown, no Apex daily
// loss limit. 100K+ rows are the Apex 4.0 EOD figures (no accounts at those sizes).
//
// `dll` is Apex's 4.0 EOD daily loss limit; the tracker only shows it for EOD
// accounts. Legacy (intraday) accounts have no Apex DLL — their daily stop is
// the plan's own dailyLossHard in TRADING_PLAN.
// `maxContracts` (minis) for 50K is the plan's self-imposed 6-mini cap (Apex allows 10).
export const APEX_CONFIGS = {
  25000:  { profitTarget: 1500,  trailingDrawdown: 1500, dll: 500,  maxContracts: 4  },
  50000:  { profitTarget: 3000,  trailingDrawdown: 2500, dll: 1000, maxContracts: 6  },
  100000: { profitTarget: 6000,  trailingDrawdown: 3000, dll: 1500, maxContracts: 8  },
  150000: { profitTarget: 9000,  trailingDrawdown: 4000, dll: 2000, maxContracts: 12 },
  250000: { profitTarget: 15000, trailingDrawdown: 6500, dll: 3250, maxContracts: 27 },
  300000: { profitTarget: 20000, trailingDrawdown: 7500, dll: 3750, maxContracts: 35 },
} as const

export type AccountSize = keyof typeof APEX_CONFIGS
export const ACCOUNT_SIZES = [25000, 50000, 100000, 150000, 250000, 300000] as const satisfies readonly AccountSize[]

// The /ES bracket: 8-tick stop ($100 on 1 ES), 12-tick target ($150) — 1:1.5.
// Set 2026-11-24 from the trader's own data: ES winners cluster at exactly +12
// ticks and 8/12 is the best-supported bracket in the sweep. (MES brackets on
// the Framework page are separate.) lib/eval-samples.ts keeps a mirror of the
// target as PLAN_TARGET_R — it must stay dependency-free; change both together.
export const ES_BRACKET = { stopTicks: 8, targetTicks: 12 } as const

// The /MES bracket, both accounts (set 2026-11-24): 2 contracts, each behind a
// 16-tick stop ($20 each, $40 total); leg 1 targets +16 ticks ($20), leg 2
// +32 ticks ($40) — $60 if both fill. Risk sits BELOW the plan's per-trade
// band ($60–75 / $100–125): a deliberate, safer choice that is slower to the
// target. Leg 2's stop does NOT move after leg 1 fills, as specified; flip
// breakevenAfterLeg1 if that changes.
export const MES_BRACKET = {
  contracts: 2,
  stopTicks: 16,
  targetTicks: [16, 32],
  breakevenAfterLeg1: false,
} as const

// The trading plan (trading_plan_apex_50k.pdf), sized against the trailing
// drawdown buffer. Applies to the eval AND to PA phase 1 (until the trail
// locks at start + $100) — the plan says keep the eval plan exactly.
export const TRADING_PLAN = {
  25000: {
    riskPerTrade: { min: 60, max: 75 },
    rewardRisk: 2,
    dailyLossHard: 150,                 // two losers, done
    maxLosers: 2,
    dailyProfitTarget: { min: 180, max: 225 },
    breakevenAt: 100,                   // move stop to BE once a trade is up ~this much
    minTradingDays: 7,
    paTrailLocksAt: 25100,
    // 1 ES at the 8-tick stop = $100 — over the $75 max, so only once the PA
    // trail has locked with $1,500+ above it (Framework /ES Authorization).
    es: { allowed: 'pa-phase-2', maxContracts: 1 },
  },
  50000: {
    riskPerTrade: { min: 100, max: 125 },
    rewardRisk: 2,
    dailyLossHard: 250,
    maxLosers: 2,
    dailyProfitTarget: { min: 300, max: 375 },
    breakevenAt: 150,
    minTradingDays: 0,
    paTrailLocksAt: 50100,
    // 1 ES at the 8-tick stop = $100 — inside the $100–$125 band. Eval or PA,
    // ATR under 6 (Framework /ES Authorization).
    es: { allowed: 'yes', maxContracts: 1 },
  },
} as const

export type PlanSize = keyof typeof TRADING_PLAN

// Sizes with no written plan fall back to the 50K plan (no live accounts there).
export function planFor(size: number) {
  return TRADING_PLAN[size as PlanSize] ?? TRADING_PLAN[50000]
}
