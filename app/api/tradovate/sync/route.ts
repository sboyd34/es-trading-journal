export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decryptPassword, authenticate, fetchAndMatchTrades } from '@/lib/tradovate-api'

const TOKEN_REFRESH_BUFFER_MS = 5 * 60_000

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: cred, error: credErr } = await supabase
      .from('tradovate_credentials')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (credErr || !cred) {
      return NextResponse.json({ error: 'Not connected to Tradovate' }, { status: 400 })
    }

    let { access_token: token, token_expiry: expiry } = cred

    // Re-authenticate if token is missing or expiring soon
    if (!token || !expiry || new Date(expiry) < new Date(Date.now() + TOKEN_REFRESH_BUFFER_MS)) {
      const password = decryptPassword(cred.password_enc)
      const auth = await authenticate(cred.username, password)
      token = auth.accessToken
      expiry = auth.expirationTime
      await supabase
        .from('tradovate_credentials')
        .update({ access_token: token, token_expiry: expiry })
        .eq('user_id', user.id)
    }

    const trades = await fetchAndMatchTrades(token)

    let inserted = 0

    if (trades.length > 0) {
      const orderIds = trades.map((t) => t.tradovate_order_id).filter(Boolean) as string[]

      const { data: existing } = await supabase
        .from('trades')
        .select('tradovate_order_id')
        .eq('user_id', user.id)
        .in('tradovate_order_id', orderIds)

      const existingIds = new Set(existing?.map((t) => t.tradovate_order_id) ?? [])
      const newTrades = trades.filter((t) => !existingIds.has(t.tradovate_order_id))

      if (newTrades.length > 0) {
        // Resolve broker_account_id → apex_accounts.id
        const brokerIds = Array.from(
          new Set(newTrades.map((t) => t.broker_account_id).filter((id): id is string => !!id)),
        )
        const brokerToAccountId = new Map<string, string>()
        if (brokerIds.length > 0) {
          const { data: matched } = await supabase
            .from('apex_accounts')
            .select('id, broker_account_id')
            .eq('user_id', user.id)
            .in('broker_account_id', brokerIds)
          for (const a of matched ?? []) {
            if (a.broker_account_id) brokerToAccountId.set(a.broker_account_id, a.id)
          }
        }

        const rows = newTrades.map((t) => ({
          user_id: user.id,
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
          account_id: t.broker_account_id ? brokerToAccountId.get(t.broker_account_id) ?? null : null,
          tags: [],
        }))
        const { data: insertedData } = await supabase.from('trades').insert(rows).select()
        inserted = insertedData?.length ?? 0
      }
    }

    const now = new Date().toISOString()
    await supabase
      .from('tradovate_credentials')
      .update({ last_sync_at: now })
      .eq('user_id', user.id)

    return NextResponse.json({ inserted, total: trades.length, lastSync: now })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    )
  }
}
