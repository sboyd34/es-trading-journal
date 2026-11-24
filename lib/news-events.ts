import spec from './news-events.json'

// Market-moving corporate events, detected from a headline. The patterns live
// in news-events.json, which ~/claude-trading-assistant's news-alerts poller
// also reads — one definition for the dashboard badge and the phone push.

export interface NewsEvent {
  type: string
  label: string
}

const flags = 'i'
const exclude = spec.exclude.map((p) => new RegExp(p, flags))
const events = spec.events.map((e) => ({
  type: e.type,
  label: e.label,
  rules: e.match.map((rule) => rule.map((p) => new RegExp(p, flags))),
}))

export const EVENT_WATCHLIST: string[] = spec.watchlist

export function detectEvent(title: string): NewsEvent | null {
  if (exclude.some((re) => re.test(title))) return null
  for (const e of events) {
    if (e.rules.some((rule) => rule.every((re) => re.test(title)))) {
      return { type: e.type, label: e.label }
    }
  }
  return null
}
