export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

function thisWeekMonday(): string {
  const now = new Date()
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = utc.getUTCDay() // 0 Sun ... 6 Sat
  const diff = day === 0 ? -6 : 1 - day
  utc.setUTCDate(utc.getUTCDate() + diff)
  return utc.toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const weekStartDate = thisWeekMonday()

  // Look up the single user in this app.
  const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers()
  if (usersError || !users?.length) {
    return NextResponse.json({ error: 'Could not load users' }, { status: 500 })
  }
  const userId = users[0].id

  // Skip if a review already exists for this week (don't overwrite manual runs).
  const { data: existing } = await supabase
    .from('weekly_reviews')
    .select('id')
    .eq('user_id', userId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ message: 'Review already exists for this week — skipped', weekStartDate })
  }

  // Derive the base URL from the request host so it works on any deployment.
  const { origin } = new URL(request.url)
  const res = await fetch(`${origin}/api/claude/weekly-review`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cronSecret ?? ''}`,
    },
    body: JSON.stringify({ weekStartDate, userId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[cron/weekly-review] generation failed', err)
    return NextResponse.json({ error: 'Weekly review generation failed', detail: err }, { status: 500 })
  }

  const data = await res.json()
  return NextResponse.json({ generated: true, weekStartDate, tradeCount: data.tradeCount })
}
