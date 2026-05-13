export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptPassword, authenticate, fetchAndMatchTrades } from '@/lib/tradovate-api'
import { isMarketHours } from '@/lib/market-hours'

const TOKEN_REFRESH_BUFFER_MS = 5 * 60_000

export async function GET(request: NextRequest) {
  // Verify Vercel cron secret when set (production guard)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!isMarketHours()) {
    return NextResponse.json({ message: 'Outside market hours — skipping sync' })
  }

  const supabase = createServiceClient()

  const { data: allCreds, error } = await supabase
    .from('tradovate_credentials')
    .select('*')
    .eq('sync_enabled', true)

  if (error) {
    return NextResponse.json({ error: 'Failed to load credentials' }, { status: 500 })
  }

  const results: Array<{ userId: string; inserted?: number; error?: string }> = []

  for (const cred of allCreds ?? []) {
    try {
      let { access_token: token, token_expiry: expiry } = cred

      if (!token || !expiry || new Date(expiry) < new Date(Date.now() + TOKEN_REFRESH_BUFFER_MS)) {
        const password = decryptPassword(cred.password_enc)
        const authResult = await authenticate(cred.username, password)
        token = authResult.accessToken
        expiry = authResult.expirationTime
        await supabase
          .from('tradovate_credentials')
          .update({ access_token: token, token_expiry: expiry })
          .eq('user_id', cred.user_id)
      }

      const trades = await fetchAndMatchTrades(token)
      let inserted = 0

      if (trades.length > 0) {
        const orderIds = trades.map((t) => t.tradovate_order_id).filter(Boolean) as string[]
        const { data: existing } = await supabase
          .from('trades')
          .select('tradovate_order_id')
          .eq('user_id', cred.user_id)
          .in('tradovate_order_id', orderIds)

        const existingIds = new Set(existing?.map((t) => t.tradovate_order_id) ?? [])
        const newTrades = trades.filter((t) => !existingIds.has(t.tradovate_order_id))

        if (newTrades.length > 0) {
          const rows = newTrades.map((t) => ({
            user_id: cred.user_id,
            date: t.date,
            entry_time: t.entry_time,
            exit_time: t.exit_time,
            direction: t.direction,
            quantity: t.quantity,
            entry_price: t.entry_price,
            exit_price: t.exit_price,
            commission: t.commission,
            instrument: t.instrument,
            tradovate_order_id: t.tradovate_order_id,
            tags: [],
          }))
          const { data: ins } = await supabase.from('trades').insert(rows).select()
          inserted = ins?.length ?? 0
        }
      }

      await supabase
        .from('tradovate_credentials')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('user_id', cred.user_id)

      results.push({ userId: cred.user_id, inserted })
    } catch (err) {
      results.push({ userId: cred.user_id, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return NextResponse.json({ synced: results.length, results })
}
