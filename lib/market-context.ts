// Pre-market market context derived from Polygon SPY data.
//
// Why SPY: the Polygon "Stocks Starter" plan cannot serve index quotes
// (I:VIX → NOT_AUTHORIZED) or futures, and SPY only trades 03:00–18:59 CT —
// so there is NO Globex/Asian/London coverage here. This module deliberately
// surfaces only what SPY can honestly provide and labels it as a proxy, so the
// brief's LLM treats it as factual structure instead of inventing overnight
// levels it cannot see.
//
// Powers two brief sections:
//   #1 Prior-session + premarket levels — concrete numbers for key_levels
//   #2 Volatility regime — an objective Compressed/Normal/Elevated anchor for
//      risk_level, derived from SPY's own realized range (no extra data auth).
//
// Self-contained and best-effort: every fetch is guarded; a failure returns
// null so the caller emits nothing (silent-when-clean) rather than blocking.

import { fetchAggregates, type PolygonCandle } from '@/lib/polygon-chart'

interface DayOHLC {
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
}

export interface MarketContext {
  proxyTicker: string // 'SPY'
  prevDay: DayOHLC | null
  premarket: {
    high: number
    low: number
    last: number
    rangePct: number // (high - low) / prevClose * 100
  } | null
  gapPct: number | null // (premarketLast - prevClose) / prevClose * 100
  vol: {
    atrPct: number // mean true range over the last `atrDays` sessions, % of close
    atrDays: number
    recentPct: number // mean true range, last 5 sessions
    olderPct: number // mean true range, sessions 6–20
    trend: 'expanding' | 'contracting' | 'stable'
    gapVsAtr: number | null // |gapPct| / atrPct — how big today's gap is vs a normal day
    regime: 'Compressed' | 'Normal' | 'Elevated'
  } | null
}

// CT hour:minute of a unix-seconds timestamp, as minutes-since-midnight.
function ctMinutes(tsSec: number): number {
  const s = new Date(tsSec * 1000).toLocaleTimeString('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

function ctDate(tsSec: number): string {
  // en-CA gives YYYY-MM-DD
  return new Date(tsSec * 1000).toLocaleDateString('en-CA', {
    timeZone: 'America/Chicago',
  })
}

// Daily bars carry the exchange's trading date, and Polygon stamps daily
// aggregates at 00:00 ET — so the canonical day must be read in Eastern time.
// (Reading them in CT rolls midnight-ET back to the prior evening, off by one.)
function etDate(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleDateString('en-CA', {
    timeZone: 'America/New_York',
  })
}

const PREMARKET_OPEN_CT = 3 * 60 // 03:00 CT — earliest SPY extended-hours bar
const REGULAR_OPEN_CT = 8 * 60 + 30 // 08:30 CT — cash open

// True range of a session given the prior close (Wilder): the greater of the
// bar range and the gap-adjusted extremes.
function trueRange(bar: PolygonCandle, prevClose: number): number {
  return Math.max(
    bar.h - bar.l,
    Math.abs(bar.h - prevClose),
    Math.abs(bar.l - prevClose),
  )
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/**
 * Fetch and derive today's market context from SPY. Returns null only when the
 * prior-day fetch fails (nothing useful to say); individual sub-sections degrade
 * to null on their own.
 */
export async function fetchMarketContext(apiKey: string): Promise<MarketContext | null> {
  const ticker = 'SPY'

  // 1) Prior trading day OHLC — the PDH/PDL/prior-close reference structure.
  let prevDay: DayOHLC | null = null
  try {
    const res = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${apiKey}`,
      { cache: 'no-store' },
    )
    if (res.ok) {
      const data = await res.json()
      const r = data?.results?.[0]
      if (r) {
        prevDay = {
          date: new Date(r.t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
          open: r.o,
          high: r.h,
          low: r.l,
          close: r.c,
        }
      }
    }
  } catch {
    // best-effort
  }
  if (!prevDay) return null

  const nowSec = Math.floor(Date.now() / 1000)
  const dayMs = 24 * 60 * 60_000

  // 2) Daily bars (last ~30 calendar days) → realized-vol regime.
  let vol: MarketContext['vol'] = null
  try {
    const daily = await fetchAggregates({
      ticker,
      fromMs: Date.now() - 40 * dayMs,
      toMs: Date.now(),
      multiplier: 1,
      timespan: 'day',
      apiKey,
      limit: 60,
    })
    if (daily && daily.length >= 7) {
      // Drop a possible partial bar for the current session (ET trading date).
      const todayEt = etDate(nowSec)
      const bars = daily.filter((b) => etDate(b.t) !== todayEt)
      const trs: number[] = []
      for (let i = 1; i < bars.length; i++) {
        trs.push((trueRange(bars[i], bars[i - 1].c) / bars[i].c) * 100)
      }
      if (trs.length >= 6) {
        const recent = trs.slice(-5)
        const older = trs.slice(-20, -5)
        const atrDays = Math.min(10, trs.length)
        const atrPct = mean(trs.slice(-atrDays))
        const recentPct = mean(recent)
        const olderPct = older.length ? mean(older) : atrPct
        const ratio = olderPct > 0 ? recentPct / olderPct : 1
        const trend: 'expanding' | 'contracting' | 'stable' =
          ratio >= 1.2 ? 'expanding' : ratio <= 0.8 ? 'contracting' : 'stable'

        vol = {
          atrPct,
          atrDays,
          recentPct,
          olderPct,
          trend,
          gapVsAtr: null, // filled after gap is known
          regime: 'Normal', // refined after gap is known
        }
      }
    }
  } catch {
    // best-effort
  }

  // 3) Today's minute bars → premarket (03:00–08:30 CT) high/low/last + gap.
  let premarket: MarketContext['premarket'] = null
  let gapPct: number | null = null
  try {
    const todayCt = ctDate(nowSec)
    const minute = await fetchAggregates({
      ticker,
      fromMs: Date.now() - dayMs, // covers "today" in CT regardless of UTC rollover
      toMs: Date.now() + 60_000,
      multiplier: 1,
      timespan: 'minute',
      apiKey,
      limit: 5000,
    })
    if (minute && minute.length > 0) {
      const pre = minute.filter((b) => {
        if (ctDate(b.t) !== todayCt) return false
        const m = ctMinutes(b.t)
        return m >= PREMARKET_OPEN_CT && m < REGULAR_OPEN_CT
      })
      if (pre.length > 0) {
        const high = Math.max(...pre.map((b) => b.h))
        const low = Math.min(...pre.map((b) => b.l))
        const last = pre[pre.length - 1].c
        premarket = {
          high,
          low,
          last,
          rangePct: ((high - low) / prevDay.close) * 100,
        }
        gapPct = ((last - prevDay.close) / prevDay.close) * 100
      }
    }
  } catch {
    // best-effort
  }

  // Refine the vol regime now that the gap is known.
  if (vol) {
    const gapVsAtr =
      gapPct !== null && vol.atrPct > 0 ? Math.abs(gapPct) / vol.atrPct : null
    // Elevated when range is expanding OR the gap eats a big slice of a normal
    // day's range; Compressed when contracting and the open is quiet.
    let regime: 'Compressed' | 'Normal' | 'Elevated' = 'Normal'
    const bigGap = gapVsAtr !== null && gapVsAtr >= 0.5
    if (vol.trend === 'expanding' || bigGap) regime = 'Elevated'
    else if (vol.trend === 'contracting' && (gapVsAtr === null || gapVsAtr < 0.3))
      regime = 'Compressed'
    vol = { ...vol, gapVsAtr, regime }
  }

  return { proxyTicker: ticker, prevDay, premarket, gapPct, vol }
}

function f2(n: number): string {
  return n.toFixed(2)
}
function pct1(n: number): string {
  const s = n >= 0 ? '+' : ''
  return `${s}${n.toFixed(2)}%`
}

/**
 * Render the market context into the two prompt sections. Returns '' when there
 * is nothing usable (no prior day), matching the other brief sections.
 */
export function formatMarketContextSection(ctx: MarketContext | null): string {
  if (!ctx || !ctx.prevDay) return ''
  const pd = ctx.prevDay
  const lines: string[] = []

  lines.push(
    '\n\nMarket context (SPY proxy — Polygon Stocks plan; covers NY premarket + ' +
      'extended hours only, NOT the Globex/Asian/London sessions, so do NOT ' +
      'invent overnight ORB levels that are not listed here):',
  )

  // #1 — concrete levels
  lines.push(
    `- SPY prior day (${pd.date}): open ${f2(pd.open)}, high ${f2(pd.high)} (PDH), ` +
      `low ${f2(pd.low)} (PDL), close ${f2(pd.close)}.`,
  )
  if (ctx.premarket) {
    const p = ctx.premarket
    lines.push(
      `- SPY premarket (03:00–08:30 CT): high ${f2(p.high)}, low ${f2(p.low)}, ` +
        `last ${f2(p.last)}, range ${p.rangePct.toFixed(2)}% of prior close.`,
    )
  } else {
    lines.push('- SPY premarket: no extended-hours bars yet (brief is running early).')
  }
  if (ctx.gapPct !== null) {
    const dir = ctx.gapPct > 0.05 ? 'gap up' : ctx.gapPct < -0.05 ? 'gap down' : 'flat'
    lines.push(`- Open gap vs prior close: ${pct1(ctx.gapPct)} (${dir}).`)
  }

  // #2 — volatility regime
  if (ctx.vol) {
    const v = ctx.vol
    const gapVs =
      v.gapVsAtr !== null
        ? ` Today's gap is ${v.gapVsAtr.toFixed(2)}× a normal day's range.`
        : ''
    lines.push(
      `- Volatility regime: ${v.regime}. SPY ${v.atrDays}-day ATR ` +
        `${v.atrPct.toFixed(2)}%/day; recent 5-day ${v.recentPct.toFixed(2)}% vs ` +
        `prior ${v.olderPct.toFixed(2)}% → range ${v.trend}.${gapVs}`,
    )
    lines.push(
      '  Use this regime to set risk_level: Elevated → expect follow-through and ' +
        'wider stops, fade less; Compressed → expect chop and failed breaks, ' +
        'favor mean-reversion at the edges and respect the dead zone.',
    )
  }

  return lines.join('\n')
}
