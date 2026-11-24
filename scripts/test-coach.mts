// Live smoke test of one Coach reply against the real API and journal.
// Run: npx tsx --tsconfig tsconfig.json scripts/test-coach.mts "your question"
// Spends real API tokens (a few cents per question).
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  if (!l.includes('=') || l.trim().startsWith('#')) continue
  const i = l.indexOf('=')
  process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}

const { runCoachReply } = await import('../lib/coach/run')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: { users } } = await sb.auth.admin.listUsers()

const question = process.argv[2] ?? 'How did my trades do this week, by account?'
const t0 = Date.now()
await runCoachReply({
  history: [{ role: 'user', content: question }],
  supabase: sb,
  userId: users[0].id,
  send: (e) => {
    if (e.type === 'text') process.stdout.write(e.text)
    else console.log(`\n[${e.type}] ${'text' in e ? e.text : e.error}`)
  },
})
console.log(`\n\n(${((Date.now() - t0) / 1000).toFixed(0)}s)`)
