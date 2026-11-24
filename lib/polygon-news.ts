import { detectEvent, EVENT_WATCHLIST, type NewsEvent } from '@/lib/news-events'

const HIGH_KEYWORDS = [
  'fed', 'federal reserve', 'fomc', 'cpi', 'nfp', 'ppi',
  'inflation', 'interest rate', 'rate hike', 'rate cut', 'payroll',
  'jobs report', 'non-farm', 'nonfarm', 'powell', 'treasury',
  'jobs', 'auction', 'gdp',
  'earnings', 'guidance', 'revenue', 'bank', 'rally', 'sell-off',
  'selloff', 'plunge', 'surge', 'soar', 'yield', 'bond',
  'oil', 'energy', 'china', 'tariff', 'recession', 'economic',
  'economy', 'market', 'stocks', 'equities',
]

const MED_KEYWORDS: string[] = []

export function classifyImpact(title: string, keywords: string[] = []): 'HIGH' | 'MED' | 'STD' {
  const text = (title + ' ' + keywords.join(' ')).toLowerCase()
  if (HIGH_KEYWORDS.some((k) => text.includes(k))) return 'HIGH'
  if (MED_KEYWORDS.some((k) => text.includes(k))) return 'MED'
  return 'STD'
}

interface PolygonArticle {
  id: string
  title: string
  publisher: { name: string }
  published_utc: string
  article_url: string
  tickers: string[]
  keywords?: string[]
}

export interface NewsArticle {
  id: string
  title: string
  source: string
  publishedAt: string
  url: string
  impact: 'HIGH' | 'MED' | 'STD'
  tickers: string[]
  // A market-moving corporate event (CEO change, M&A, halt…), or null.
  event: NewsEvent | null
}

// SPY for macro/index coverage; Mag 7 for single-name earnings that move /ES.
// Shared with the phone-alert poller via lib/news-events.json.
const DEFAULT_TICKERS = EVENT_WATCHLIST

export async function fetchPolygonNews(params: {
  apiKey: string
  hours?: number
  limit?: number
  tickers?: string[]
  publishedGte?: string
  publishedLte?: string
}): Promise<NewsArticle[]> {
  const { apiKey, hours = 24, limit = 20, tickers = DEFAULT_TICKERS } = params
  const publishedGte =
    params.publishedGte ||
    new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  // ONE market-wide request, filtered to the watchlist here. The key allows 5
  // requests a minute; the old per-ticker fan-out made 8 per refresh, so 3
  // tickers came back 429 → [] and silently vanished from the feed. A day is
  // ~500 market-wide articles, so one page (max 1000) covers 24h; one extra
  // page is followed if a heavy day overflows it.
  const want = new Set(tickers)
  const url = new URL('https://api.polygon.io/v2/reference/news')
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('published_utc.gte', publishedGte)
  if (params.publishedLte) url.searchParams.set('published_utc.lte', params.publishedLte)
  url.searchParams.set('limit', '1000')
  url.searchParams.set('sort', 'published_utc')
  url.searchParams.set('order', 'desc')

  const all: PolygonArticle[] = []
  let next: string | null = url.toString()
  for (let page = 0; page < 2 && next; page++) {
    try {
      const res: Response = await fetch(next, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      if (!res.ok) break
      const data: { results?: PolygonArticle[]; next_url?: string } = await res.json()
      all.push(...((data.results || []) as PolygonArticle[]))
      next = data.next_url ? `${data.next_url}&apiKey=${apiKey}` : null
    } catch {
      break
    }
  }

  const seen = new Set<string>()
  const merged: PolygonArticle[] = []
  for (const a of all) {
    if (seen.has(a.id) || !(a.tickers || []).some((t) => want.has(t))) continue
    seen.add(a.id)
    merged.push(a)
  }

  merged.sort(
    (a, b) => new Date(b.published_utc).getTime() - new Date(a.published_utc).getTime()
  )

  return merged.slice(0, limit).map((a) => ({
    id: a.id,
    title: a.title,
    source: a.publisher?.name || 'Unknown',
    publishedAt: a.published_utc,
    url: a.article_url,
    impact: classifyImpact(a.title, a.keywords || []),
    tickers: a.tickers || [],
    event: detectEvent(a.title),
  }))
}

// One entry per story: a big event produces dozens of articles (44 for one
// CEO change), so group by watchlist ticker + event type and keep the newest
// headline with a count. Input is newest-first, as fetchPolygonNews returns it.
export interface NewsEventStory {
  key: string
  ticker: string
  event: NewsEvent
  latest: NewsArticle
  count: number
}

export function groupEventStories(articles: NewsArticle[]): NewsEventStory[] {
  const stories = new Map<string, NewsEventStory>()
  for (const a of articles) {
    if (!a.event) continue
    const ticker = a.tickers.find((t) => DEFAULT_TICKERS.includes(t)) ?? a.tickers[0] ?? '—'
    const key = `${ticker}:${a.event.type}`
    const s = stories.get(key)
    if (s) s.count++
    else stories.set(key, { key, ticker, event: a.event, latest: a, count: 1 })
  }
  return Array.from(stories.values())
}

export function findNewsRelatedEntryTimes<T extends { entry_time: string }>(
  trades: T[],
  articles: NewsArticle[],
  windowMs = 15 * 60 * 1000
): Set<string> {
  const highImpact = articles.filter((a) => a.impact === 'HIGH')
  const related = new Set<string>()
  for (const trade of trades) {
    const entryMs = new Date(trade.entry_time).getTime()
    const hasNearby = highImpact.some(
      (a) => Math.abs(entryMs - new Date(a.publishedAt).getTime()) <= windowMs
    )
    if (hasNearby) related.add(trade.entry_time)
  }
  return related
}

export interface TradeNewsArticleRef {
  title: string
  source: string
  url: string
  publishedAt: string
  impact: 'HIGH' | 'MED' | 'STD'
}

// For each trade's entry_time, returns the high-impact articles published
// within `windowMs` of that entry, sorted by proximity (closest first).
// Includes the entry_time → [] entries so callers can see which trades
// had no nearby news (returns Map keyed by entry_time string).
export function mapNewsToTrades<T extends { entry_time: string }>(
  trades: T[],
  articles: NewsArticle[],
  windowMs = 15 * 60 * 1000
): Map<string, TradeNewsArticleRef[]> {
  const highImpact = articles.filter((a) => a.impact === 'HIGH')
  const out = new Map<string, TradeNewsArticleRef[]>()
  for (const trade of trades) {
    const entryMs = new Date(trade.entry_time).getTime()
    const matched: { article: NewsArticle; deltaMs: number }[] = []
    for (const a of highImpact) {
      const delta = Math.abs(entryMs - new Date(a.publishedAt).getTime())
      if (delta <= windowMs) matched.push({ article: a, deltaMs: delta })
    }
    matched.sort((a, b) => a.deltaMs - b.deltaMs)
    out.set(trade.entry_time, matched.map(({ article }) => ({
      title: article.title,
      source: article.source,
      url: article.url,
      publishedAt: article.publishedAt,
      impact: article.impact,
    })))
  }
  return out
}
