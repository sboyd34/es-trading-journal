export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { runCoachReply, type ChatTurn, type CoachEvent } from '@/lib/coach/run'

const MAX_TURNS = 40
const MAX_CHARS = 8000

function parseHistory(body: unknown): ChatTurn[] | null {
  const msgs = (body as { messages?: unknown })?.messages
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > MAX_TURNS) return null
  const turns: ChatTurn[] = []
  for (const m of msgs) {
    const role = (m as ChatTurn)?.role
    const content = (m as ChatTurn)?.content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    if (!content.trim() || content.length > MAX_CHARS) return null
    turns.push({ role, content })
  }
  if (turns[0].role !== 'user' || turns[turns.length - 1].role !== 'user') return null
  return turns
}

// Streams one Coach reply as newline-delimited JSON events:
// {type:'text'|'status'|'error', ...} then {type:'done'}.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const history = parseHistory(await request.json().catch(() => null))
  if (!history) return NextResponse.json({ error: 'Invalid messages' }, { status: 400 })

  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: CoachEvent | { type: 'done' }) =>
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      try {
        await runCoachReply({ history, supabase, userId: user.id, signal: request.signal, send })
        send({ type: 'done' })
      } catch (err) {
        if (!request.signal.aborted) {
          console.error('[coach] error', err)
          const error = err instanceof Anthropic.RateLimitError
            ? 'Coach is rate-limited right now. Try again in a minute.'
            : err instanceof Anthropic.APIError
              ? `Coach hit an API error (${err.status ?? 'network'}).`
              : 'Coach hit an unexpected error.'
          send({ type: 'error', error })
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
