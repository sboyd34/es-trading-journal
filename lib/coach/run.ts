import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TRADING_SYSTEM_PROMPT } from '@/lib/trading-system'
import { COACH_TOOLS, TOOL_STATUS, runCoachTool } from '@/lib/coach/tools'

// One Coach reply: the model/tool loop, reported as events. Kept out of the
// route so it can be exercised directly (scripts/test-coach.mts).

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const MAX_STEPS = 8 // model calls per reply (tool rounds + pause_turn resumes)

// Frozen, so it caches with the tools ahead of it. Today's date goes in a
// second block after the breakpoint.
const SYSTEM = `You are Coach, a seasoned futures trading mentor inside this trader's ES Trading Journal. The trader day-trades /ES and /MES on Apex legacy prop-firm accounts (a 25K and a 50K eval), trades around a day job, and is building toward trading as a real income stream.

You can talk about anything concerning trading: market structure, order flow, the trader's setups and indicators, volume profile, risk and position sizing, prop-firm rules, trading psychology and discipline, journaling, building and testing an edge, and current market events.

THE TRADER'S OWN DATA: You have read-only tools over their journal. Any statement about their trades, stats, accounts, rule-following or reviews must come from a tool call in this conversation - never estimate or invent their numbers. Say the date range and sample size behind a figure, and say plainly when a sample is too small to mean much. If a question can be answered from their data, look before answering. You cannot change anything in the journal.

CURRENT EVENTS: Use web search for anything time-sensitive (today's market, economic calendar, news, earnings) and name your sources. Don't search for timeless concepts you already know.

THEIR SYSTEM - coach against it, and use its exact names:
${TRADING_SYSTEM_PROMPT}

HOW TO COACH:
- Be direct, specific and encouraging. Lead with the answer, then the evidence. The trader is data-driven and responds to honest numbers and positive energy, not lectures.
- Tie advice back to their plan and their data. When their numbers and the plan disagree, say so and let them decide.
- You are a coach and educator, not a signal service: don't tell them to buy or sell a specific market now, and don't promise outcomes. You can walk through how a trade would or wouldn't fit their rules.
- Formatting: plain text with short paragraphs. Use "- " bullets for lists. No markdown headers, tables, bold or code blocks - the chat shows raw text. Keep most replies under 250 words unless they ask for depth.`

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  ...COACH_TOOLS,
  // One lookup can run several searches (dynamic filtering); 3 ran out
  // mid-answer in testing. ~$0.01 per search.
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
]

export type ChatTurn = { role: 'user' | 'assistant'; content: string }
export type CoachEvent =
  | { type: 'text'; text: string }
  | { type: 'status'; text: string }
  | { type: 'error'; error: string }

export async function runCoachReply(opts: {
  history: ChatTurn[]
  supabase: SupabaseClient
  userId: string
  signal?: AbortSignal
  send: (event: CoachEvent) => void
}): Promise<void> {
  const { history, supabase, userId, signal, send } = opts
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const isoToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

  // Earlier turns come back as plain text only - dropping every thinking block
  // from past turns is allowed. Within this reply the history is append-only.
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.content }))

  for (let step = 0; step < MAX_STEPS; step++) {
    const params = {
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' as const },
      system: [
        { type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } },
        { type: 'text' as const, text: `Today is ${today} (${isoToday}), US Central time.` },
      ],
      tools: TOOLS,
      messages,
      // Server-side fallback: on a safety decline the API re-runs the turn on
      // a model chosen by refusal category. Not yet typed in SDK 0.95.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }
    const stream = anthropic.beta.messages.stream(
      params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming,
      { signal },
    )

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'tool_use' || block.type === 'server_tool_use') {
          send({ type: 'status', text: TOOL_STATUS[block.name] ?? 'Looking that up' })
        }
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        send({ type: 'text', text: event.delta.text })
      }
    }
    const message = await stream.finalMessage()

    if (message.stop_reason === 'refusal') {
      send({ type: 'error', error: "Coach couldn't answer that one. Try rephrasing." })
      return
    }
    if (message.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: message.content })
      continue
    }
    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (toolUses.length === 0) return // end_turn, or a text reply cut at max_tokens
    if (message.stop_reason === 'max_tokens') {
      send({ type: 'error', error: 'Reply ran too long. Try a narrower question.' })
      return
    }

    messages.push({ role: 'assistant', content: message.content })
    // All results go back in one user message, in call order.
    const results = await Promise.all(toolUses.map((b) => runCoachTool(b, { supabase, userId })))
    messages.push({ role: 'user', content: results })
  }
  send({ type: 'error', error: 'Coach hit its lookup limit for one reply. Ask a narrower question.' })
}
