import { buildRSamples, POINT_VALUES, type SampleTrade } from '../lib/eval-samples.ts'

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
const round = (v: number, dp = 6) => Math.round(v * 10 ** dp) / 10 ** dp

const RISK = 500

// A fixture shaped like the live sample: mixed instruments, mixed quantities,
// winners and losers, and — critically — the tight-stop MES rows that the
// previous per-trade-risk model inflated by 25-50x.
const fixture: SampleTrade[] = [
  { net_pnl: 1,      quantity: 1, instrument: 'MES', mfe: 0.75 },  // was ~50x
  { net_pnl: -12.5,  quantity: 1, instrument: 'MES', mfe: 0.25 },
  { net_pnl: 250,    quantity: 1, instrument: 'ES',  mfe: 7 },
  { net_pnl: -500,   quantity: 2, instrument: 'ES',  mfe: 2 },
  { net_pnl: 87.5,   quantity: 1, instrument: 'MES', mfe: null },  // no excursion
  { net_pnl: 1200,   quantity: 1, instrument: 'NQ',  mfe: 61 },
  { net_pnl: -40,    quantity: 2, instrument: 'MNQ', mfe: null },
]

// ---------- the invariant the old model violated ----------
// r is defined as net_pnl / riskPerTrade, so multiplying back by the SAME
// constant must reproduce every trade's dollars exactly. Under the old model
// r was net_pnl / perTradeStopRisk but was re-scaled by a single constant
// riskPerTrade, so this held only for the stopless fallback rows.
{
  const samples = buildRSamples(fixture, RISK)
  const replayed = samples.map(s => round(s.r * RISK))
  const actual = fixture.map(t => round(t.net_pnl))
  check('round-trip: every trade replays its own dollars', replayed, actual)
}

// Expectancy must survive the round trip. The old model reported $49.25/trade
// against an actual $14.88 — a 231% inflation. This is the headline assertion.
{
  const samples = buildRSamples(fixture, RISK)
  const simMean = (samples.reduce((s, x) => s + x.r, 0) / samples.length) * RISK
  const actualMean = fixture.reduce((s, t) => s + t.net_pnl, 0) / fixture.length
  check('expectancy preserved', round(simMean, 10), round(actualMean, 10))
}

// The scale is arbitrary but must be exactly linear: doubling riskPerTrade
// halves every r, leaving replayed dollars unchanged.
{
  const a = buildRSamples(fixture, 250)
  const b = buildRSamples(fixture, 1000)
  check(
    'scale invariance',
    a.map(s => round(s.r * 250)),
    b.map(s => round(s.r * 1000)),
  )
}

// ---------- mfeR: excursion coverage no longer gated on stop_loss ----------
// SampleTrade has no stop_loss field at all — structurally, the trailing
// ratchet can no longer be silenced by a missing stop. Coverage is now
// exactly "does this trade have an MFE".
{
  const samples = buildRSamples(fixture, RISK)
  check('mfeR present iff mfe present', samples.map(s => s.mfeR !== null), [
    true, true, true, true, false, true, false,
  ])
}

// MFE is stored in POINTS. Converting to R requires the instrument multiplier
// and the contract count — 0.75 pts on 1 MES is $3.75, not 0.75 of anything.
{
  const samples = buildRSamples(fixture, RISK)
  check('mfeR MES 1 contract',  round(samples[0].mfeR!), round((0.75 * 5) / RISK))
  check('mfeR ES 1 contract',   round(samples[2].mfeR!), round((7 * 50) / RISK))
  check('mfeR ES 2 contracts',  round(samples[3].mfeR!), round((2 * 50 * 2) / RISK))
  check('mfeR NQ 1 contract',   round(samples[5].mfeR!), round((61 * 20) / RISK))
}

// ---------- instrument and quantity fallbacks ----------
{
  const s = buildRSamples(
    [
      { net_pnl: 100, quantity: null,     instrument: null,    mfe: 4 },
      { net_pnl: 100, quantity: 1,        instrument: 'XYZ',   mfe: 4 },
    ],
    RISK,
  )
  check('null instrument defaults to ES', round(s[0].mfeR!), round((4 * 50) / RISK))
  check('null quantity defaults to 1',    round(s[0].mfeR!), round((4 * 50 * 1) / RISK))
  check('unknown instrument defaults to ES', round(s[1].mfeR!), round((4 * 50) / RISK))
}

check('point values', POINT_VALUES, { ES: 50, MES: 5, NQ: 20, MNQ: 2 })

// ---------- guards ----------
// riskPerTrade is the sole denominator now. A zero or negative value would
// silently produce Infinity/NaN R values that simulate() would happily
// consume, so it must fail loudly instead.
for (const bad of [0, -500, NaN]) {
  let threw = false
  try {
    buildRSamples(fixture, bad)
  } catch {
    threw = true
  }
  check(`rejects riskPerTrade=${bad}`, threw, true)
}

check('empty input', buildRSamples([], RISK), [])

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
