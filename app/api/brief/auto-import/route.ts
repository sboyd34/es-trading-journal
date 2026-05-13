export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { format } from 'date-fns'

function validateSecret(request: NextRequest): boolean {
  const expected = process.env.JOURNAL_AUTO_SECRET || ''
  if (!expected) return false
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  const xSecret = request.headers.get('x-journal-secret') || ''
  return bearer === expected || xSecret === expected
}

export async function OPTIONS() {
  return new Response(null, { status: 200 })
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { brief?: unknown; scheduledTime?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { brief, scheduledTime } = body

  if (!brief || typeof brief !== 'string') {
    return NextResponse.json({ error: 'brief (string) is required' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const today = format(new Date(), 'yyyy-MM-dd')

  const { data: profiles } = await supabase.from('profiles').select('id').limit(1)
  const userId = profiles?.[0]?.id
  if (!userId) {
    return NextResponse.json({ error: 'No user profile found' }, { status: 500 })
  }

  const { error: upsertError } = await supabase
    .from('daily_briefs')
    .upsert(
      { user_id: userId, date: today, brief_text: brief },
      { onConflict: 'user_id,date' }
    )

  if (upsertError) {
    return NextResponse.json(
      { error: `DB error: ${upsertError.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    date: today,
    scheduledTime: scheduledTime ?? null,
  })
}
