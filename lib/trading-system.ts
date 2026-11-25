import { APEX_CONFIGS, ES_BRACKET, MES_BRACKET, TRADING_PLAN, type PlanSize } from '@/lib/apex-config'

export const SYSTEM_SETUPS = [
  'A+ Confluence',
  'ORB Break',
  'TTM Squeeze',
  'AVWAP Bounce',
  '21-EMA Bounce',
  'FVG Bounce',
  'VAH/VAL Bounce',
  'Fresh Supply/Demand',
  'Divergence/Trendline Break',
  'FireLines Level',
  'Price Action',
  'No Setup',
] as const

export const SYSTEM_LOCATIONS = [
  'ORH/ORL',
  'VWAP/AVWAP',
  'VAH/VAL',
  'PDH/PDL',
  'Overnight High/Low',
  'Prior Swing Extreme',
  'Fresh Supply/Demand',
] as const

export const SYSTEM_CHECKLIST_ITEMS = [
  '1H bias clear?',
  '15m setup present?',
  '5m trigger confirmed?',
  'Real location (not POC, mid-value, or chop)?',
  'Room to target?',
  'Following setup priority order?',
  'Calm mind, no P&L urgency?',
  'OR width adequate (at least 30% of prior day ATR)?',
  'Squeeze at Tier 1 or Tier 2 location only?',
] as const

// The one statement of how time of day is treated, shared by every AI prompt.
// Inline copies of the old window rules drifted apart and kept penalizing
// out-of-window trades; import this instead of restating it.
export const SESSION_TIME_POLICY = `
Session Times (CT) — REFERENCE ONLY, NOT A RULE. The trader trades whenever their schedule allows, so entries at ANY time of day are allowed. Time of day is never a rule violation, never lowers a grade, and must never be listed as a mistake. Use session context only to describe market conditions:
- Session opens (ORB setup timing — the opening range builds in the first 15 min, ORB entries come after it): Tokyo 19:00 (OR 19:00–19:15), Shanghai 20:30 (OR 20:30–20:45), London 02:00 (OR 02:00–02:15), NY 08:30 (OR 08:30–08:45). ORB applies to session OPENS only, not the Tokyo (22:30) or Shanghai (00:00) lunch reopens.
- Liquidity context: NY RTH (08:30–15:00) is usually deepest; the NY lunch (11:00–12:30) is often thin and choppy; other extended hours have thinner liquidity, wider stops, and more fakeouts.
`.trim()

// The risk plan as AI prompts see it, generated from TRADING_PLAN so the
// coaching can never disagree with the position sizer or the Framework page.
const planLine = (label: string, size: PlanSize) => {
  const p = TRADING_PLAN[size]
  const esRisk = ES_BRACKET.stopTicks * 12.5
  const esOverBand = esRisk > p.riskPerTrade.max
    ? ` — above the $${p.riskPerTrade.max} per-trade band by the trader's deliberate choice, NOT a violation; one ES loser uses $${esRisk} of the $${p.dailyLossHard} daily stop`
    : ''
  return `- ${label} (trailing drawdown $${APEX_CONFIGS[size].trailingDrawdown.toLocaleString()}, intraday, counts open profit): risk $${p.riskPerTrade.min}–$${p.riskPerTrade.max}/trade at 1:${p.rewardRisk}; HARD daily stop -$${p.dailyLossHard} or ${p.maxLosers} losers, whichever comes first, then done; daily profit target +$${p.dailyProfitTarget}, then stop; move stop to breakeven once up ~$${p.breakevenAt}; /ES: ${p.es.allowed === 'yes' ? `allowed in eval or PA, max ${p.es.maxContracts} contract, ${ES_BRACKET.stopTicks}-tick stop ($${esRisk}${esOverBand}) / ${ES_BRACKET.targetTicks}-tick target ($${ES_BRACKET.targetTicks * 12.5})` :`NOT allowed in the eval (1 ES at ${ES_BRACKET.stopTicks} ticks = $${esRisk} > $${p.riskPerTrade.max} max) — only in PA phase 2 after the trail locks`}`
}
export const RISK_PLAN_POLICY = `
Apex Legacy Risk Plan (eval and PA until the trail locks — sized against the drawdown buffer):
${planLine('50K', 50000)}
${planLine('25K', 25000)}
- /MES bracket (both accounts): ${MES_BRACKET.contracts} contracts, each behind a ${MES_BRACKET.stopTicks}-tick stop ($${MES_BRACKET.contracts * MES_BRACKET.stopTicks * 1.25} total risk); leg 1 targets +${MES_BRACKET.targetTicks[0]} ticks, leg 2 +${MES_BRACKET.targetTicks[1]} ticks ($${(MES_BRACKET.targetTicks[0] + MES_BRACKET.targetTicks[1]) * 1.25} if both fill)${MES_BRACKET.breakevenAfterLeg1 ? "; leg 2's stop moves to breakeven when leg 1 fills" : ''}. Deliberately below the per-trade risk band above.
- Since 2026-11-24 each account's daily loss limit and daily profit target are set as hard limits in Tradovate, so the platform enforces the dollar limits. The three-loser rule and the /ES contract max are NOT platform-enforced — they rest on the trader alone
- Fixed profit targets, no runners — the trail counts unrealized gains, so a winner that comes back raises the floor
- Never increase size to catch up after a red day; never trade past either daily limit; no re-entries after a max-loss morning
- Post-loss day: trade half base size for the session
`.trim()

export const TRADING_SYSTEM_PROMPT = `
TRADING SYSTEM RULES (evaluate ALL trades against these — be specific, not generic):

Core Model: 1H Bias → 15m Setup → 5m Trigger
- Bull bias: 1H close above 21 EMA, rising, not chopping → LONGS ONLY
- Bear bias: 1H close below 21 EMA, falling, not chopping → SHORTS ONLY
- Neutral: repeated crossing, flat EMA, messy structure → retests only or no trade

${SESSION_TIME_POLICY}

Setup Priority (trade in this order, do not skip):
1. 15-minute ORB (Break → Retest → 5m confirmation → Enter; OR must be ≥30% of prior day ATR)
2. TTM Squeeze fire/pullback continuation (Tier 1 locations default; Tier 2 requires extra confirmation candle)
3. AVWAP Bounce (requires 1H bias + price respecting AVWAP + 5m confirmation + room to target)
4. 21-EMA Bounce (trend pullback into the 21 EMA — the bias line itself; requires 1H bias + confluence + 5m confirmation off the EMA + room to target)
5. FVG Bounce (location tool with confluence; must align with 1H bias + real trigger)
6. VAH/VAL Bounce (volume-profile boundary; requires 1H bias + confluence + 5m trigger + room to POC or opposite VA — never trade the VAH/VAL alone)
7. Divergence/Trendline Break (alert only, never standalone — must appear at meaningful level with 5m trigger)

Entry Rule (must follow ALL steps): Break → Retest → Confirm → Enter
BANNED entries: anticipation, blind-touch, chasing, entering on bubble/fire alone

Approved Locations: ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight high/low, prior swing extremes, fresh supply/demand with confluence

Banned Locations: POC, mid-value, overlapping candles, obvious chop, signals firing into nearby major levels

Hard Operating Rule — must confirm ALL FIVE before every trade:
1. Bias — 1H direction clear and aligned?
2. Setup — which of the 7 setups is this?
3. Trigger — exact 5m signal?
4. Location — approved location with room to target?
5. Risk — stop and target defined?
Cannot state all five = no trade. Period.

Grade Rubric:
A grade: 1H bias clear and aligned, correct setup from priority list, approved location with room, Break→Retest→Confirm→Enter sequence followed, emotionally flat
B grade: One minor deviation — slightly early entry, Tier 2 location without extra confirmation candle, or small size adjustment
C grade: ANY of these: POC/mid-value/chop entry, no bias or wrong direction vs bias, chased extended candle, entered on bubble/fire alone, FOMO or revenge state, blind-touch trade

${RISK_PLAN_POLICY}

1-Minute Refinement Rule:
- Only after 5m proven break with real close (not wick)
- Only for pullback/retest entry, never anticipation
- Hard bans: 1H mixed/neutral, sloppy OR, weak 5m break, chop/POC, red on day, urgent/frustrated/FOMO state
`.trim()

export const PLAYBOOK_SETUPS = [
  {
    name: 'ORB Break',
    description: '15-minute opening range breakout. The primary setup of the session.',
    entry_criteria: '1. Build 08:30–08:45 opening range.\n2. Wait for break of ORH or ORL with momentum.\n3. Retest the broken level on pullback.\n4. 5m confirmation close beyond the retest.\n5. Enter with stop below retest low (long) or above retest high (short).\nOR must be at least 30% of prior day ATR. If breakout snaps back inside OR — stand down.',
    exit_criteria: 'Target prior day high/low, VWAP extension, or measured move. Scale at 1R, trail remainder. Exit immediately if price reclaims the OR.',
    tags: ['primary', 'opening-range', 'breakout'],
  },
  {
    name: 'TTM Squeeze',
    description: 'TTM Squeeze fire with pullback continuation. Tier 1 locations by default.',
    entry_criteria: '1. Wait for squeeze FIRE (dot changes color — red to green or green to red).\n2. Do NOT enter on the fire alone — wait for pullback.\n3. Pullback to a meaningful level (VWAP, prior swing, supply/demand).\n4. 5m confirmation close in direction of squeeze.\n5. Tier 1 locations only by default. Tier 2 requires an extra confirmation candle.\nNEVER enter at POC, chop, or when there is no room to target.',
    exit_criteria: 'Target the next major level. Scale at 1R. Trail with 5m structure. Exit if price returns to squeeze fire candle low/high.',
    tags: ['squeeze', 'momentum', 'continuation'],
  },
  {
    name: 'AVWAP Bounce',
    description: 'AVWAP is a decision area, not an automatic entry. Requires full confluence.',
    entry_criteria: '1. 1H bias must be clear and aligned with the trade direction.\n2. Price approaches AVWAP with momentum slowing.\n3. 5m confirmation: hold candle, rejection wick, or reclaim-loss signal.\n4. Must have confluence (VWAP, prior swing, VAH/VAL, etc.).\n5. Must have clear room to target — do not trade into nearby major resistance.',
    exit_criteria: 'Target next AVWAP, VAH/VAL, or prior swing. Scale at 1R. Exit if 5m closes decisively through AVWAP.',
    tags: ['vwap', 'bounce', 'confluence'],
  },
  {
    name: '21-EMA Bounce',
    description: 'Trend pullback into the 21 EMA — the same line that sets the 1H bias. The most bias-aligned continuation entry in the system, and never a standalone signal.',
    entry_criteria: '1. 1H bias clear — price above a rising 21 EMA for longs, below a falling one for shorts.\n2. Pullback into the 21 EMA on the 15m (touch or slight wick through — not a close beyond).\n3. 5m confirmation off the EMA: rejection wick, hold candle, or reclaim close.\n4. Confluence required (VWAP/AVWAP, prior swing, FireLines level, VAH/VAL) — never the EMA alone.\n5. Room to target: prior swing extreme in the trade direction.\nIf the 15m closes decisively beyond the EMA the setup is dead — that is a bias change, not a bounce. If the EMA is flat, there is no trend to pull back into: no trade.',
    exit_criteria: 'Target the prior swing extreme in the trade direction, or the next major level (FireLines, VAH/VAL, PDH/PDL). Scale at 1R, trail the runner with 5m structure. Exit if a 5m closes back through the EMA against the trade.',
    tags: ['ema', 'bounce', 'trend-continuation'],
  },
  {
    name: 'FVG Bounce',
    description: 'Fair Value Gap as a location tool with confluence. Not a standalone entry.',
    entry_criteria: '1. Identify a clear FVG (3-candle pattern, visible gap in price).\n2. Must align with 1H bias direction.\n3. Wait for price to fill the FVG and show rejection.\n4. Real 5m trigger required — hold candle or rejection close.\n5. Must have additional confluence (VWAP, AVWAP, swing level) and room to target.',
    exit_criteria: 'Target prior swing high/low or the next key structure. Exit if price fills the entire FVG and continues through.',
    tags: ['fvg', 'gap', 'location'],
  },
  {
    name: 'VAH/VAL Bounce',
    description: 'Value Area High/Low rejection or reclaim. Volume-profile-derived support/resistance — never traded alone.',
    entry_criteria: '1. 1H bias must be clear and aligned with the trade direction.\n2. Identify prior session VAH or VAL — current price approaches from inside (boundary holds) or from outside (rejection back into value).\n3. 5m confirmation: rejection wick, hold candle, or reclaim of the level.\n4. Must have confluence (AVWAP, FireLines, prior swing, etc.) — never the VAH/VAL alone.\n5. Clear room to target — at minimum POC or the opposite VA boundary in the trade direction.',
    exit_criteria: 'Target POC (mean reversion), opposite VA boundary, or prior swing. Scale at 1R. Exit if 5m closes decisively through the VAH/VAL level.',
    tags: ['value-area', 'bounce', 'volume-profile'],
  },
  {
    name: 'Divergence/Trendline Break',
    description: 'Alert-only setup. Never standalone. Must appear at a meaningful level with full confirmation.',
    entry_criteria: '1. Identify divergence (price makes new high/low, indicator does not) OR trendline break.\n2. This is an ALERT only — do not enter on divergence alone.\n3. Must appear at a meaningful structure level (swing high/low, VAH/VAL, VWAP).\n4. Wait for structure confirmation: break of key swing, reclaim of level.\n5. Real 5m trigger required before entry.\nIf divergence appears in chop or mid-range — ignore completely.',
    exit_criteria: 'Target prior structure high/low. Scale at 1R. Exit immediately if divergence resolves without structural confirmation.',
    tags: ['divergence', 'trendline', 'reversal'],
  },
]
