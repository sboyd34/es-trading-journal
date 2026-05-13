export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data } = await supabase
      .from('tradovate_credentials')
      .select('username, token_expiry, last_sync_at, sync_enabled')
      .eq('user_id', user.id)
      .single()

    if (!data) return NextResponse.json({ connected: false, lastSync: null })

    const connected = !!(data.token_expiry && new Date(data.token_expiry) > new Date())

    return NextResponse.json({
      connected,
      username: data.username,
      lastSync: data.last_sync_at,
      syncEnabled: data.sync_enabled,
    })
  } catch {
    return NextResponse.json({ connected: false, lastSync: null })
  }
}
