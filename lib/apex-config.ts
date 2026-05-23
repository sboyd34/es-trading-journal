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
