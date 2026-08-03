export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

function validateSecret(request: NextRequest): boolean {
  const expected = process.env.JOURNAL_AUTO_SECRET || ''
  if (!expected) return false
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  const xSecret = request.headers.get('x-journal-secret') || ''
  return bearer === expected || xSecret === expected
}

// The brief is keyed to the Monday of the week it describes. Validating that
// here means a scheduling bug shows up as a 400 rather than as a brief silently
// filed under a week the UI never queries.
function isMonday(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  return d.getUTCDay() === 1
}

export async function OPTIONS() {
  return new Response(null, { status: 200 })
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { brief?: unknown; weekStartDate?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { brief, weekStartDate } = body

  if (!brief || typeof brief !== 'string') {
    return NextResponse.json({ error: 'brief (string) is required' }, { status: 400 })
  }
  if (typeof weekStartDate !== 'string' || !isMonday(weekStartDate)) {
    return NextResponse.json(
      { error: 'weekStartDate must be a YYYY-MM-DD Monday' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  const { data: profiles } = await supabase.from('profiles').select('id').limit(1)
  const userId = profiles?.[0]?.id
  if (!userId) {
    return NextResponse.json({ error: 'No user profile found' }, { status: 500 })
  }

  const { error: upsertError } = await supabase
    .from('weekly_market_briefs')
    .upsert(
      { user_id: userId, week_start_date: weekStartDate, brief_text: brief },
      { onConflict: 'user_id,week_start_date' }
    )

  if (upsertError) {
    return NextResponse.json({ error: `DB error: ${upsertError.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, weekStartDate })
}
