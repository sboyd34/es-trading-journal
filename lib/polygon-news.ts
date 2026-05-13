const HIGH_KEYWORDS = [
  'fed', 'federal reserve', 'fomc', 'cpi', 'nfp', 'ppi',
  'inflation', 'interest rate', 'rate hike', 'rate cut', 'payroll',
  'jobs report', 'non-farm', 'nonfarm', 'powell', 'treasury',
  'jobs', 'auction', 'gdp',
]

const MED_KEYWORDS = [
  'earnings', 'guidance', 'revenue', 'bank', 'rally', 'sell-off',
  'selloff', 'plunge', 'surge', 'soar', 'yield', 'bond',
  'oil', 'energy', 'china', 'tariff', 'recession', 'economic',
  'economy', 'market', 'stocks', 'equities',
]

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
}

export async function fetchPolygonNews(params: {
  apiKey: string
  hours?: number
  limit?: number
  publishedGte?: string
  publishedLte?: string
}): Promise<NewsArticle[]> {
  const { apiKey, hours = 24, limit = 20 } = params
  const publishedGte =
    params.publishedGte ||
    new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  const url = new URL('https://api.polygon.io/v2/reference/news')
  url.searchParams.set('apiKey', apiKey)
  url.searchParams.set('ticker', 'SPY')
  url.searchParams.set('published_utc.gte', publishedGte)
  if (params.publishedLte) url.searchParams.set('published_utc.lte', params.publishedLte)
  url.searchParams.set('limit', String(Math.min(limit, 50)))
  url.searchParams.set('sort', 'published_utc')
  url.searchParams.set('order', 'desc')

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || []).map((a: PolygonArticle) => ({
      id: a.id,
      title: a.title,
      source: a.publisher?.name || 'Unknown',
      publishedAt: a.published_utc,
      url: a.article_url,
      impact: classifyImpact(a.title, a.keywords || []),
      tickers: a.tickers || [],
    }))
  } catch {
    return []
  }
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
