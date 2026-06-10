export const SYSTEM_SETUPS = [
  'A+ Confluence',
  'ORB Break',
  'TTM Squeeze',
  'AVWAP Bounce',
  'FVG Bounce',
  'Divergence/Trendline Break',
  'FireLines Level',
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
  'Day-type ok for secondary window (if applicable)?',
  'Squeeze at Tier 1 or Tier 2 location only?',
] as const

export const TRADING_SYSTEM_PROMPT = `
TRADING SYSTEM RULES (evaluate ALL trades against these — be specific, not generic):

Core Model: 1H Bias → 15m Setup → 5m Trigger
- Bull bias: 1H close above 21 EMA, rising, not chopping → LONGS ONLY
- Bear bias: 1H close below 21 EMA, falling, not chopping → SHORTS ONLY
- Neutral: repeated crossing, flat EMA, messy structure → retests only or no trade

Approved Time Windows (CT):
- 08:30–08:45: Building opening range ONLY — no trades
- 08:45–09:30: ORB primary window
- 09:30–10:30: Continuation, retests, clean squeezes only
- 10:30–11:00: A+ continuation or retest only
- 11:00–12:30: Dead zone — no trades
- 12:30–14:00: Secondary window — only if: morning had clear directional move AND no macro events 12:00–14:30 AND 15m VWAP slope aligned with 1H bias
- 14:00–15:15: Closing drive — valid if: clear directional momentum into close AND 1H bias confirmed AND not chasing exhausted move

Setup Priority (trade in this order, do not skip):
1. 15-minute ORB (Break → Retest → 5m confirmation → Enter; OR must be ≥30% of prior day ATR)
2. TTM Squeeze fire/pullback continuation (Tier 1 locations default; Tier 2 requires extra confirmation candle)
3. AVWAP Bounce (requires 1H bias + price respecting AVWAP + 5m confirmation + room to target)
4. FVG Bounce (location tool with confluence; must align with 1H bias + real trigger)
5. Divergence/Trendline Break (alert only, never standalone — must appear at meaningful level with 5m trigger)

Entry Rule (must follow ALL steps): Break → Retest → Confirm → Enter
BANNED entries: anticipation, blind-touch, chasing, entering on bubble/fire alone

Approved Locations: ORH/ORL, VWAP/AVWAP, VAH/VAL, PDH/PDL, overnight high/low, prior swing extremes, fresh supply/demand with confluence

Banned Locations: POC, mid-value, overlapping candles, obvious chop, signals firing into nearby major levels

Hard Operating Rule — must confirm ALL FIVE before every trade:
1. Bias — 1H direction clear and aligned?
2. Setup — which of the 5 setups is this?
3. Trigger — exact 5m signal?
4. Location — approved location with room to target?
5. Risk — stop and target defined?
Cannot state all five = no trade. Period.

Grade Rubric:
A grade: 1H bias clear and aligned, correct setup from priority list, approved location with room, Break→Retest→Confirm→Enter sequence followed, emotionally flat
B grade: One minor deviation — slightly early entry, Tier 2 location without extra confirmation candle, or small size adjustment
C grade: ANY of these: POC/mid-value/chop entry, no bias or wrong direction vs bias, chased extended candle, entered on bubble/fire alone, FOMO or revenge state, blind-touch trade

Apex 50K Risk Framework:
- Evaluation: hard stop -$250, soft stop -$150, max 2 trades/day, default risk $100/trade (base 1 ES or 2 MES)
- PA: hard stop -$150, soft stop -$120, max 2 trades/day, default risk $40–80/trade (base 2 MES; 1 ES on A+ only)
- Post-loss day: automatically trade half base size for the session

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
    name: 'FVG Bounce',
    description: 'Fair Value Gap as a location tool with confluence. Not a standalone entry.',
    entry_criteria: '1. Identify a clear FVG (3-candle pattern, visible gap in price).\n2. Must align with 1H bias direction.\n3. Wait for price to fill the FVG and show rejection.\n4. Real 5m trigger required — hold candle or rejection close.\n5. Must have additional confluence (VWAP, AVWAP, swing level) and room to target.',
    exit_criteria: 'Target prior swing high/low or the next key structure. Exit if price fills the entire FVG and continues through.',
    tags: ['fvg', 'gap', 'location'],
  },
  {
    name: 'Divergence/Trendline Break',
    description: 'Alert-only setup. Never standalone. Must appear at a meaningful level with full confirmation.',
    entry_criteria: '1. Identify divergence (price makes new high/low, indicator does not) OR trendline break.\n2. This is an ALERT only — do not enter on divergence alone.\n3. Must appear at a meaningful structure level (swing high/low, VAH/VAL, VWAP).\n4. Wait for structure confirmation: break of key swing, reclaim of level.\n5. Real 5m trigger required before entry.\nIf divergence appears in chop or mid-range — ignore completely.',
    exit_criteria: 'Target prior structure high/low. Scale at 1R. Exit immediately if divergence resolves without structural confirmation.',
    tags: ['divergence', 'trendline', 'reversal'],
  },
]
