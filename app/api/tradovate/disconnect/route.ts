export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { error } = await supabase
      .from('tradovate_credentials')
      .delete()
      .eq('user_id', user.id)

    if (error) throw error

    return NextResponse.json({ disconnected: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Disconnect failed' },
      { status: 500 },
    )
  }
}
