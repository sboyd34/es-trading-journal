export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { fetchPolygonNews } from '@/lib/polygon-news'

export async function GET(request: NextRequest) {
  const apiKey = process.env.POLYGON_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured', articles: [] }, { status: 200 })
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '5'), 20)
  const hours = parseInt(searchParams.get('hours') || '24')
  const entryTime = searchParams.get('entryTime')

  try {
    const articles = await fetchPolygonNews({ apiKey, hours, limit: limit * 3 })

    if (entryTime) {
      const entryMs = new Date(entryTime).getTime()
      const FIFTEEN_MIN = 15 * 60 * 1000
      const nearby = articles.filter(
        (a) => Math.abs(entryMs - new Date(a.publishedAt).getTime()) <= FIFTEEN_MIN && a.impact === 'HIGH'
      )
      return NextResponse.json({ articles: nearby, total: nearby.length })
    }

    return NextResponse.json({ articles: articles.slice(0, limit), total: articles.length })
  } catch {
    return NextResponse.json({ error: 'News temporarily unavailable', articles: [] }, { status: 200 })
  }
}
