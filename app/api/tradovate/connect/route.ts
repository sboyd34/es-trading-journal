export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { encryptPassword, authenticate } from '@/lib/tradovate-api'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { username, password } = await request.json()
    if (!username?.trim() || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 })
    }

    // Reuse existing device_id if already connected
    const { data: existing } = await supabase
      .from('tradovate_credentials')
      .select('device_id')
      .eq('user_id', user.id)
      .single()

    const deviceId = existing?.device_id ?? randomUUID()

    // Verify credentials with Tradovate before storing
    const { accessToken, expirationTime } = await authenticate(username.trim(), password)

    const { error } = await supabase
      .from('tradovate_credentials')
      .upsert(
        {
          user_id: user.id,
          username: username.trim(),
          password_enc: encryptPassword(password),
          device_id: deviceId,
          access_token: accessToken,
          token_expiry: expirationTime,
          sync_enabled: true,
        },
        { onConflict: 'user_id' },
      )

    if (error) throw error

    return NextResponse.json({ connected: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Connection failed' },
      { status: 400 },
    )
  }
}
