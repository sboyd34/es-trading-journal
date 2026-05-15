// Map a futures instrument to a liquid stock proxy that Polygon's
// Stocks Starter plan can serve intraday data for.

export interface InstrumentProxy {
  ticker: string
  note: string  // shown in UI to explain the proxy
}

const PROXY_MAP: Record<string, InstrumentProxy> = {
  ES:  { ticker: 'SPY', note: 'SPY proxy for S&P 500 futures' },
  MES: { ticker: 'SPY', note: 'SPY proxy for S&P 500 futures' },
  NQ:  { ticker: 'QQQ', note: 'QQQ proxy for Nasdaq-100 futures' },
  MNQ: { ticker: 'QQQ', note: 'QQQ proxy for Nasdaq-100 futures' },
  YM:  { ticker: 'DIA', note: 'DIA proxy for Dow futures' },
  MYM: { ticker: 'DIA', note: 'DIA proxy for Dow futures' },
  RTY: { ticker: 'IWM', note: 'IWM proxy for Russell 2000 futures' },
  M2K: { ticker: 'IWM', note: 'IWM proxy for Russell 2000 futures' },
  GC:  { ticker: 'GLD', note: 'GLD proxy for gold futures' },
  CL:  { ticker: 'USO', note: 'USO proxy for crude oil futures' },
}

export function getProxy(instrument: string): InstrumentProxy {
  const key = instrument.toUpperCase()
  return PROXY_MAP[key] ?? { ticker: 'SPY', note: `SPY proxy (no specific match for ${instrument})` }
}
