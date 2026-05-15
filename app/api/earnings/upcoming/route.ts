export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { fetchUpcomingEarnings } from '@/lib/finnhub-earnings'

export async function GET(request: NextRequest) {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'API key not configured', earnings: [] },
      { status: 200 }
    )
  }

  const { searchParams } = new URL(request.url)
  const days = Math.min(parseInt(searchParams.get('days') || '7'), 30)
  const symbolsParam = searchParams.get('symbols')
  const symbols = symbolsParam
    ? symbolsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined

  try {
    const earnings = await fetchUpcomingEarnings({ apiKey, days, symbols })
    return NextResponse.json({ earnings, total: earnings.length })
  } catch {
    return NextResponse.json(
      { error: 'Earnings calendar temporarily unavailable', earnings: [] },
      { status: 200 }
    )
  }
}
