export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const ids = body?.ids

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
    }

    if (!ids.every((id) => typeof id === 'string')) {
      return NextResponse.json({ error: 'ids must contain only strings' }, { status: 400 })
    }

    const { error, count } = await supabase
      .from('trades')
      .delete({ count: 'exact' })
      .in('id', ids)
      .eq('user_id', user.id)

    if (error) {
      console.error('Bulk delete error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, deleted: count ?? 0 })
  } catch (err) {
    console.error('POST /api/trades/bulk-delete error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
