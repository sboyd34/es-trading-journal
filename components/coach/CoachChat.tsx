'use client'

import { useEffect, useRef, useState } from 'react'
import { GraduationCap, Send, Square, RotateCcw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Turn = { role: 'user' | 'assistant'; content: string; error?: string }

const STORAGE_KEY = 'coach_chat_v1'
const MAX_SENT_TURNS = 40 // the route rejects longer histories

const STARTERS = [
  'Did I follow my plan this week, account by account?',
  'Which of my setups actually has an edge so far?',
  'What should I work on most before my next session?',
  "What's on the economic calendar this week that could move ES?",
  'Explain how to read a failed ORB and when to stand down.',
  'How do I stop trading after my second loser?',
]

// The history the route accepts: non-empty turns, starting with the user,
// trimmed to the most recent MAX_SENT_TURNS.
function historyFor(turns: Turn[]): { role: Turn['role']; content: string }[] {
  let h = turns.filter((t) => t.content.trim()).map(({ role, content }) => ({ role, content }))
  h = h.slice(-MAX_SENT_TURNS)
  while (h.length && h[0].role !== 'user') h = h.slice(1)
  return h
}

export default function CoachChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // Per-browser convenience only; an unreadable store just starts fresh.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setTurns(JSON.parse(saved))
    } catch { /* start fresh */ }
  }, [])
  useEffect(() => {
    if (busy) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(turns)) } catch { /* ignore */ }
  }, [turns, busy])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns, status])

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return
    const next: Turn[] = [...turns, { role: 'user', content: question }]
    setTurns([...next, { role: 'assistant', content: '' }])
    setInput('')
    setBusy(true)
    setStatus('Thinking')

    const patchLast = (fn: (t: Turn) => Turn) =>
      setTurns((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])])

    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/claude/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyFor(next) }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as { type: string; text?: string; error?: string }
          if (event.type === 'text') {
            setStatus(null)
            patchLast((t) => ({ ...t, content: t.content + event.text }))
          } else if (event.type === 'status') {
            setStatus(event.text ?? null)
          } else if (event.type === 'error') {
            patchLast((t) => ({ ...t, error: event.error }))
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        patchLast((t) => ({ ...t, error: err instanceof Error ? err.message : 'Something went wrong' }))
      }
    } finally {
      setBusy(false)
      setStatus(null)
      abortRef.current = null
    }
  }

  function newChat() {
    abortRef.current?.abort()
    setTurns([])
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-3xl mx-auto">
      <div className="flex items-start justify-between pb-4 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <GraduationCap className="h-5 w-5 text-blue-500 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Coach</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Ask anything about trading. It reads your journal and can search the web.
            </p>
          </div>
        </div>
        {turns.length > 0 && (
          <button
            onClick={newChat}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700"
          >
            <RotateCcw className="h-3.5 w-3.5" /> New chat
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-5">
        {turns.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-left text-sm text-gray-700 dark:text-gray-300 rounded-xl border border-gray-200 dark:border-gray-700/60 bg-white dark:bg-gray-800/50 px-4 py-3 hover:border-blue-500/50 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) => {
          const isLast = i === turns.length - 1
          return (
            <div key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
                  t.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 text-gray-800 dark:text-gray-200',
                )}
              >
                {t.content}
                {t.role === 'assistant' && isLast && busy && status && (
                  <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 italic">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status}…
                  </span>
                )}
                {t.error && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{t.error}</p>}
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input) }}
        className="flex items-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-800"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
          }}
          rows={2}
          maxLength={8000}
          placeholder="Ask your coach… (Enter to send, Shift+Enter for a new line)"
          className="flex-1 resize-none rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-blue-500"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="h-11 w-11 flex items-center justify-center rounded-xl bg-gray-700 text-white hover:bg-gray-600"
            aria-label="Stop"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="h-11 w-11 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </form>
    </div>
  )
}
