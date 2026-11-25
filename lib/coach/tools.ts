import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApexAccount, Trade } from '@/types'
import { APEX_CONFIGS, TRADING_PLAN, type AccountSize, type PlanSize } from '@/lib/apex-config'
import { accountDayFacts, accountDayFactLines } from '@/lib/account-day-rules'

// The Coach's read-only window into the journal. Every query is scoped to the
// signed-in user (RLS plus an explicit user_id filter) and nothing here writes.
// Inputs are tiny filter objects, validated by hand before any query runs.

const DATE = /^\d{4}-\d{2}-\d{2}$/
const GROUPS = ['setup', 'account', 'instrument', 'direction', 'grade', 'mood', 'weekday', 'hour_ct', 'month'] as const
type GroupBy = (typeof GROUPS)[number]

const accountFilter = {
  type: 'string',
  description: 'Account name or size, e.g. "25k" or "50K Profit". Omit for all accounts.',
}
const dateRange = {
  from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
  to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
}

export const COACH_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: 'search_trades',
    description:
      "List the trader's own trades, newest first, with entry/exit, P&L, setup, grade, bias, location, mood, MAE/MFE (ticks), ATR at entry, TP answers and notes. Use for any question about specific trades.",
    input_schema: {
      type: 'object',
      properties: {
        ...dateRange,
        account: accountFilter,
        setup: { type: 'string', description: 'Setup name or part of it, e.g. "ORB". Use "untagged" for trades with no setup.' },
        instrument: { type: 'string', enum: ['ES', 'MES', 'NQ', 'MNQ'] },
        direction: { type: 'string', enum: ['long', 'short'] },
        outcome: { type: 'string', enum: ['win', 'loss'] },
        limit: { type: 'integer', description: 'Max trades to return, 1-200 (default 50).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'trade_stats',
    description:
      'Aggregate performance (trades, win rate, net P&L, average win/loss, profit factor, expectancy) grouped one way. Use for "how do my X trades do" questions instead of listing every trade.',
    input_schema: {
      type: 'object',
      properties: {
        ...dateRange,
        account: accountFilter,
        group_by: { type: 'string', enum: [...GROUPS] },
      },
      required: ['group_by'],
      additionalProperties: false,
    },
  },
  {
    name: 'account_status',
    description:
      "Each Apex account's current state (balances, profit toward the eval target, trailing drawdown remaining, today's P&L) and its plan limits.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'day_rule_check',
    description:
      "For one trading date, check each account's trades against its own plan: hard stop (loser limit / daily loss), trades after it, profit target, size and /ES ATR breaches. Computed in code - cite it rather than recomputing.",
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Trading date YYYY-MM-DD.' } },
      required: ['date'],
      additionalProperties: false,
    },
  },
  {
    name: 'journal_reviews',
    description:
      'Saved weekly reviews (summary, violations, lessons, next-week focus) and daily session notes (discipline score, end-of-day summary) in a date range.',
    input_schema: {
      type: 'object',
      properties: dateRange,
      additionalProperties: false,
    },
  },
]

export const TOOL_STATUS: Record<string, string> = {
  search_trades: 'Searching your trades',
  trade_stats: 'Crunching your stats',
  account_status: 'Checking your accounts',
  day_rule_check: 'Checking the day against your plan',
  journal_reviews: 'Reading your reviews',
  web_search: 'Searching the web',
  // web_search_20260209 filters its results with server-side code execution.
  code_execution: 'Searching the web',
}

interface Ctx {
  supabase: SupabaseClient
  userId: string
}

class InputError extends Error {}

function optString(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key]
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v !== 'string') throw new InputError(`${key} must be a string`)
  return v.trim()
}
function optDate(input: Record<string, unknown>, key: string): string | undefined {
  const v = optString(input, key)
  if (v !== undefined && !DATE.test(v)) throw new InputError(`${key} must be YYYY-MM-DD`)
  return v
}
function optEnum<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined {
  const v = optString(input, key)
  if (v !== undefined && !allowed.includes(v as T)) throw new InputError(`${key} must be one of ${allowed.join(', ')}`)
  return v as T | undefined
}

const round = (n: number) => Math.round(n * 100) / 100
const ct = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', ...opts })
const ctTime = (iso: string) => ct(iso, { hour: '2-digit', minute: '2-digit', hour12: false })

async function loadAccounts({ supabase, userId }: Ctx): Promise<ApexAccount[]> {
  const { data, error } = await supabase.from('apex_accounts').select('*').eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (data as ApexAccount[]) ?? []
}

// "25k", "50K", or any part of an account's name.
function matchAccounts(accounts: ApexAccount[], query: string): ApexAccount[] {
  const q = query.toLowerCase().replace(/\s+/g, '')
  return accounts.filter((a) =>
    a.name.toLowerCase().replace(/\s+/g, '').includes(q) || `${a.account_size / 1000}k` === q,
  )
}

async function loadTrades(ctx: Ctx, input: Record<string, unknown>, accounts: ApexAccount[]): Promise<Trade[]> {
  const from = optDate(input, 'from')
  const to = optDate(input, 'to')
  const account = optString(input, 'account')
  let q = ctx.supabase.from('trades').select('*').eq('user_id', ctx.userId).order('entry_time', { ascending: false })
  if (from) q = q.gte('date', from)
  if (to) q = q.lte('date', to)
  if (account) {
    const ids = matchAccounts(accounts, account).map((a) => a.id)
    if (ids.length === 0) throw new InputError(`no account matches "${account}" (accounts: ${accounts.map((a) => a.name).join(', ')})`)
    q = q.in('account_id', ids)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data as Trade[]) ?? []
}

function stats(trades: Trade[]) {
  const wins = trades.filter((t) => t.net_pnl > 0)
  const losses = trades.filter((t) => t.net_pnl <= 0)
  const grossWin = wins.reduce((s, t) => s + t.net_pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.net_pnl, 0))
  const net = grossWin - grossLoss
  return {
    trades: trades.length,
    wins: wins.length,
    win_rate_pct: trades.length ? round((100 * wins.length) / trades.length) : 0,
    net_pnl: round(net),
    avg_win: wins.length ? round(grossWin / wins.length) : null,
    avg_loss: losses.length ? round(-grossLoss / losses.length) : null,
    profit_factor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    expectancy_per_trade: trades.length ? round(net / trades.length) : 0,
  }
}

function groupKey(t: Trade, by: GroupBy, accountName: (id: string | null) => string): string {
  switch (by) {
    case 'setup': return t.setup_tag || 'untagged'
    case 'account': return accountName(t.account_id)
    case 'instrument': return t.instrument || 'ES'
    case 'direction': return t.direction
    case 'grade': return t.grade ?? 'ungraded'
    case 'mood': return t.mood ?? 'not recorded'
    case 'weekday': return ct(t.entry_time, { weekday: 'short' })
    case 'hour_ct': return `${ct(t.entry_time, { hour: '2-digit', hour12: false })}:00`
    case 'month': return t.date.slice(0, 7)
  }
}

async function run(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  const accounts = await loadAccounts(ctx)
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const accountName = (id: string | null) => (id && byId.get(id)?.name) || 'unlinked'

  switch (name) {
    case 'search_trades': {
      const setup = optString(input, 'setup')?.toLowerCase()
      const instrument = optEnum(input, 'instrument', ['ES', 'MES', 'NQ', 'MNQ'] as const)
      const direction = optEnum(input, 'direction', ['long', 'short'] as const)
      const outcome = optEnum(input, 'outcome', ['win', 'loss'] as const)
      const rawLimit = input.limit
      if (rawLimit !== undefined && (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit))) throw new InputError('limit must be an integer')
      const limit = Math.min(Math.max((rawLimit as number | undefined) ?? 50, 1), 200)

      const matched = (await loadTrades(ctx, input, accounts)).filter((t) =>
        (!setup || (setup === 'untagged' ? !t.setup_tag : (t.setup_tag ?? '').toLowerCase().includes(setup))) &&
        (!instrument || (t.instrument || 'ES') === instrument) &&
        (!direction || t.direction === direction) &&
        (!outcome || (outcome === 'win' ? t.net_pnl > 0 : t.net_pnl <= 0)),
      )
      return {
        matched: matched.length,
        returned: Math.min(matched.length, limit),
        net_pnl_of_matched: round(matched.reduce((s, t) => s + t.net_pnl, 0)),
        trades: matched.slice(0, limit).map((t) => ({
          date: t.date,
          entry_ct: ctTime(t.entry_time),
          exit_ct: ctTime(t.exit_time),
          account: accountName(t.account_id),
          instrument: t.instrument || 'ES',
          direction: t.direction,
          qty: t.quantity,
          entry: t.entry_price,
          exit: t.exit_price,
          net_pnl: t.net_pnl,
          setup: t.setup_tag,
          grade: t.grade,
          bias: t.trade_bias,
          location: t.trade_location,
          trigger: t.trade_trigger,
          mood: t.mood,
          stop: t.stop_loss,
          target: t.target,
          mae_ticks: t.mae_ticks,
          mfe_ticks: t.mfe_ticks,
          loss_type: t.loss_type,
          atr_at_entry: t.atr_at_entry,
          tp1_hit: t.first_target_hit,
          tp2_hit: t.second_target_hit,
          notes: t.notes ? t.notes.slice(0, 300) : null,
        })),
      }
    }

    case 'trade_stats': {
      const by = optEnum(input, 'group_by', GROUPS)
      if (!by) throw new InputError('group_by is required')
      const trades = await loadTrades(ctx, input, accounts)
      const groups = new Map<string, Trade[]>()
      for (const t of trades) {
        const k = groupKey(t, by, accountName)
        groups.set(k, [...(groups.get(k) ?? []), t])
      }
      return {
        overall: stats(trades),
        groups: Array.from(groups.entries())
          .map(([key, rows]) => ({ [by]: key, ...stats(rows) }))
          .sort((a, b) => b.trades - a.trades),
        note: 'Wins are net P&L > 0. Small groups are noisy - weigh sample size.',
      }
    }

    case 'account_status': {
      return accounts.map((a) => {
        const cfg = APEX_CONFIGS[a.account_size as AccountSize]
        const plan = TRADING_PLAN[a.account_size as PlanSize]
        return {
          name: a.name,
          size: a.account_size,
          mode: a.mode,
          drawdown_type: a.drawdown_type,
          starting_balance: a.starting_balance,
          current_balance: a.current_balance,
          highest_balance: a.highest_balance,
          todays_pnl: round(a.current_balance - a.todays_starting_balance),
          profit_earned: round(a.current_balance - a.starting_balance),
          // Same figures the Apex tracker shows.
          eval_profit_target: cfg?.profitTarget ?? null,
          profit_still_needed: cfg ? round(Math.max(0, a.starting_balance + cfg.profitTarget - a.current_balance)) : null,
          trailing_drawdown: cfg?.trailingDrawdown ?? null,
          drawdown_remaining: cfg ? round(cfg.trailingDrawdown - (a.highest_balance - a.current_balance)) : null,
          plan: plan
            ? {
                risk_per_trade: plan.riskPerTrade,
                daily_loss_limit: plan.dailyLossHard,
                max_losers_per_day: plan.maxLosers,
                daily_profit_target: plan.dailyProfitTarget,
                es_max_contracts: plan.es.maxContracts,
              }
            : 'no written plan for this size',
          balances_updated: a.updated_at,
        }
      })
    }

    case 'day_rule_check': {
      const date = optDate(input, 'date')
      if (!date) throw new InputError('date is required')
      const { data, error } = await ctx.supabase
        .from('trades').select('*').eq('user_id', ctx.userId).eq('date', date).order('entry_time', { ascending: true })
      if (error) throw new Error(error.message)
      const trades = (data as Trade[]) ?? []
      if (trades.length === 0) return { date, trades: 0, note: 'No trades on this date.' }
      const numbered = trades.map((t, i) => ({ t, no: i + 1 }))
      const keys = Array.from(new Set(trades.map((t) => (t.account_id && byId.has(t.account_id) ? t.account_id : 'unlinked'))))
      return {
        date,
        trades: trades.length,
        note: "Trade numbers are the day's chronological order across all accounts.",
        accounts: keys.map((key) => {
          const rows = numbered.filter(({ t }) => (t.account_id && byId.has(t.account_id) ? t.account_id : 'unlinked') === key)
          const account = byId.get(key)
          const facts = account
            ? accountDayFacts(rows.map(({ t, no }) => ({ no, instrument: t.instrument, quantity: t.quantity, net_pnl: t.net_pnl, atr_at_entry: t.atr_at_entry })), account)
            : null
          return {
            account: account?.name ?? 'unlinked (no plan applies)',
            trades: rows.map(({ t, no }) => `#${no} ${ctTime(t.entry_time)} CT ${t.direction} ${t.quantity}x ${t.instrument || 'ES'} $${t.net_pnl}`),
            rule_facts: facts ? accountDayFactLines(facts) : null,
          }
        }),
      }
    }

    case 'journal_reviews': {
      const from = optDate(input, 'from')
      const to = optDate(input, 'to')
      let rq = ctx.supabase.from('weekly_reviews').select('week_start_date,week_end_date,trade_count,total_pnl,review')
        .eq('user_id', ctx.userId).order('week_start_date', { ascending: false }).limit(8)
      if (from) rq = rq.gte('week_end_date', from)
      if (to) rq = rq.lte('week_start_date', to)
      let sq = ctx.supabase.from('daily_sessions').select('date,discipline_score,end_of_day_summary,notes')
        .eq('user_id', ctx.userId).order('date', { ascending: false }).limit(20)
      if (from) sq = sq.gte('date', from)
      if (to) sq = sq.lte('date', to)
      const [{ data: reviews, error: re }, { data: sessions, error: se }] = await Promise.all([rq, sq])
      if (re) throw new Error(re.message)
      if (se) throw new Error(se.message)
      return {
        weekly_reviews: (reviews ?? []).map((r) => ({
          week: `${r.week_start_date} to ${r.week_end_date}`,
          trades: r.trade_count,
          net_pnl: r.total_pnl,
          summary: r.review?.summary,
          compliance_score: r.review?.system_compliance?.score,
          violations: r.review?.system_compliance?.violations,
          lessons: r.review?.top_lessons,
          next_week_focus: r.review?.next_week_focus,
        })),
        daily_sessions: (sessions ?? [])
          .filter((s) => s.discipline_score !== null || s.end_of_day_summary || s.notes)
          .map((s) => ({
            date: s.date,
            discipline_score: s.discipline_score,
            notes: s.notes ? String(s.notes).slice(0, 300) : null,
            eod_summary: s.end_of_day_summary ? JSON.stringify(s.end_of_day_summary).slice(0, 800) : null,
          })),
      }
    }

    default:
      throw new InputError(`unknown tool ${name}`)
  }
}

// Runs one tool call. Bad input comes back as an is_error result the model can
// correct; anything else (a database error) is reported the same way rather
// than failing the whole chat turn.
export async function runCoachTool(
  block: { id: string; name: string; input: unknown },
  ctx: Ctx,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  try {
    if (typeof block.input !== 'object' || block.input === null || Array.isArray(block.input)) {
      throw new InputError('input must be an object')
    }
    const result = await run(block.name, block.input as Record<string, unknown>, ctx)
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'tool failed'
    return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: message }
  }
}
