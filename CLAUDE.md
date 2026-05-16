# ES Trading Journal

A futures trading journal for /ES and /MES. Built solo. Production: https://es-trading-journal.vercel.app

## Stack

- **Next.js 14** (App Router)
- **TypeScript**, **Tailwind**
- **Supabase** — Postgres + Auth
- **Vercel** — hosting (auto-deploys `main`)
- **Anthropic API** — Claude Sonnet 4.6 for AI narratives, pre-market brief, weekly review
- **Polygon** — news (SPY + Mag 7 fan-out)
- **Finnhub** — earnings calendar
- **Tradovate** — broker fill sync

## Directory shape

```
app/(app)/        Authed UI pages: dashboard, journal, pre-market, playbook, weekly-review, apex
app/(auth)/       Login/signup
app/api/          Server routes (claude/*, trades/*, tradovate/*, news, earnings, brief, market-state)
components/       React UI (journal/, apex/, ui/, layout/, providers/)
lib/              Shared utils. Notable: polygon-news.ts, finnhub-earnings.ts, tradovate-parser.ts, tradovate-api.ts
supabase/         SQL migrations (run manually — see Migration workflow)
types/            TS types (index.ts is the main one)
```

## Trading system

The journal scaffolds a 5-setup system grounded in:

- **1H bias** (above/below 21 EMA) → **15m structure** → **5m execution**
- **Time windows**: Opening Drive · Discovery · Midday Drift · Lunch Lull · Closing Drive (all CT)
- **Apex evaluation rules**: trailing drawdown + daily loss limit, enforced per account
- **Multi-account model**: `apex_accounts` table holds each broker account; `trades.account_id` FK ties every fill back to one. `broker_account_id` maps Tradovate's account label to your apex_accounts row.

## Instrument multipliers (CRITICAL)

P&L is computed via Postgres generated columns based on `trades.instrument`:

| Instrument | $/pt |
|---|---|
| ES | 50 |
| NQ | 20 |
| MES | 5 |
| MNQ | 2 |

If you see a MES trade reporting 10× the expected P&L, the `add_instrument.sql` migration hasn't been run yet — see Migration workflow.

## Conventions

- **useMemo-first** for derived state in client components. Don't recompute on every render.
- **Silent-when-clean cards** — components return `null` when there's nothing meaningful to show, rather than rendering an empty state placeholder.
- **Add features as tabs** in existing pages where possible, instead of creating new pages.
- **No trailing summaries** in chat or commit bodies — keep it tight.
- **Atomic commits**. One concern per commit. Title format: `<Area>: <imperative phrase>`. Body explains *why*, not *what*. Trailer: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- **No tests yet** — manual UI verification in the dev browser is the current QA model. `npx tsc --noEmit` is the gating check.

## Common commands

```bash
npm run dev                # start dev server (kill stale procs first if port 3000 hangs)
npx tsc --noEmit           # type-check (gating check)
npm run lint               # next lint
npm run build              # production build sanity check
vercel --prod              # manual production deploy
git push origin main       # triggers Vercel auto-deploy
```

## Env vars (9 required)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — Claude API
- `POLYGON_API_KEY` — news
- `FINNHUB_API_KEY` — earnings calendar
- `TRADOVATE_ENCRYPTION_KEY` — encrypts broker creds at rest
- `JOURNAL_AUTO_SECRET` — auth gate for `/api/brief/auto-import`
- `CRON_SECRET` — guards `/api/tradovate/cron`

Missing keys typically return empty arrays rather than 500s (e.g., `/api/news`, `/api/earnings/upcoming`). Silent fail.

## ⚠️ NEVER run `vercel env pull` against `.env.local`

It has wiped working configs before. Sensitive vars return empty and silently overwrite the real values. To add a new env var locally: append the line by hand. (See the PreToolUse hook in `.claude/settings.json` — it now blocks this.)

## Cron jobs

- `/api/tradovate/cron` — fires `30 14 * * 1-5` (14:30 UTC Mon-Fri = NY open). Pulls overnight fills.

## API integration patterns

**Polygon news** (`lib/polygon-news.ts`):
- Parallel fan-out across SPY + AAPL/MSFT/NVDA/GOOGL/AMZN/META/TSLA
- Dedup by article id, sort newest-first
- Classifier: HIGH keyword list (Fed/CPI/earnings/etc) → all else is STD
- Per-trade match window: ±15 min of `entry_time` for HIGH-impact articles

**Finnhub earnings** (`lib/finnhub-earnings.ts`):
- 7-day default lookahead
- Watchlist: Mag 7 + JPM/BAC/WMT/HD
- `hourLabel`: BMO / AMC / DMH / TBD
- Exposed at `/api/earnings/upcoming?days=7`, rendered on `/pre-market`

**Tradovate sync** (`app/api/tradovate/sync/route.ts`):
- Groups raw fills by `(accountId, contractName, date)` → completed trades
- Resolves `broker_account_id` → `apex_accounts.id` per-trade
- Past data has had direction / commission bugs — re-import suspect periods after schema fixes

**AI narratives** (`app/api/trades/[id]/narrative/route.ts`):
- Reads trade facts (timing, MFE/MAE, stop/target, news ±15min, mood, criteria)
- ~150-word coach review + what-went-right/wrong/lesson
- Cached on `trades.ai_narrative` column

## Migration workflow

SQL files live in `supabase/`. No automated tracker yet — runs are manual:

1. Write the migration as `supabase/<verb>_<subject>.sql`
2. Open the Supabase dashboard → SQL editor → paste & run
3. Note in session carryover that it's been applied

Outstanding migrations (verify before relying on related features):

- `add_instrument.sql` — MES/NQ/MNQ P&L correction. **Must be run** before MES trades report correct P&L.

## Memory artifacts the user maintains

The user has session-level memory at `~/.claude/projects/-Users-shawndeeboyd/memory/`. Three relevant files:

- `feedback_trading_journal_style.md` — codifies useMemo-first, silent-when-clean, tab additions
- `feedback_vercel_env_pull.md` — the .env.local disaster lore
- `project_es_trading_journal.md` — stack + features snapshot

Read these for context if behavior seems opinionated and there's no obvious reason in the code.
