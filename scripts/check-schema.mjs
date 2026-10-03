#!/usr/bin/env node
/**
 * Schema drift detector — `npm run check:schema`
 *
 * WHY THIS EXISTS
 * ---------------
 * Migrations live in version control (`supabase/*.sql`) but get applied BY HAND
 * in the Supabase dashboard. Nothing checks that a committed migration actually
 * ran. That gap has bitten this project twice:
 *   - `pre_open_check`  (add_pre_open_check.sql)  → pre-market ritual silently
 *                                                   failed to save (42703).
 *   - `instrument`      (add_instrument.sql)      → MES/NQ P&L computed wrong.
 *
 * This script closes the failure CLASS, not just the two instances. It parses
 * every `ADD COLUMN` out of the migration files (the single source of truth for
 * what the code assumes exists), then probes the LIVE database for each one. A
 * committed-but-unapplied migration shows up instantly as a missing column,
 * named, with the exact .sql file to run.
 *
 * Design notes:
 *   - Zero dependencies. Plain Node (>=18 for global fetch), reads .env.local
 *     by hand. Does NOT shell out to `vercel env pull` (see CLAUDE.md warning).
 *   - Parses ADD COLUMN only — not CREATE TABLE — which sidesteps the
 *     apex_settings→apex_accounts rename (those columns came via CREATE TABLE)
 *     and keeps false positives at zero.
 *   - Auto-syncs: every future `ADD COLUMN IF NOT EXISTS` you write is checked
 *     automatically. No manifest to maintain.
 *
 * INDEXES
 * -------
 * Columns answer for themselves — asking PostgREST for a missing one returns
 * 42703. Indexes have no such tell: they change the query plan, never the shape
 * of a response, so an index-only migration could sit unapplied while every
 * column probe came back green. Index checks therefore route through the
 * `public.schema_index_names()` helper (supabase/add_schema_index_introspection.sql),
 * compared against every CREATE INDEX parsed out of the migration files.
 *
 * Exit codes: 0 = all expected columns and indexes present. 1 = drift found or
 * config error.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase')

// ── ANSI helpers (no dep) ──────────────────────────────────────────────────
const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

// ── Env loading (process.env wins, else parse .env.local) ──────────────────
function loadEnv() {
  const out = { ...process.env }
  try {
    const raw = readFileSync(join(REPO_ROOT, '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '')
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      // .env.local takes precedence only if process.env didn't already set it
      if (out[key] === undefined || out[key] === '') out[key] = val
    }
  } catch {
    // No .env.local — rely on process.env (e.g. CI).
  }
  return out
}

// ── Migration parser: extract { table, column, file } for every ADD COLUMN ──
function parseExpectedColumns() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const expected = [] // { table, column, file }
  const seen = new Set() // table.column dedupe

  const alterRe = /^alter\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/i
  const addColRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi

  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    let currentTable = null

    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/--.*$/, '') // strip line comments
      if (!line.trim()) continue

      const alterMatch = line.match(alterRe)
      if (alterMatch) currentTable = alterMatch[1].toLowerCase()

      if (currentTable) {
        let m
        addColRe.lastIndex = 0
        while ((m = addColRe.exec(line)) !== null) {
          const column = m[1].toLowerCase()
          const key = `${currentTable}.${column}`
          if (!seen.has(key)) {
            seen.add(key)
            expected.push({ table: currentTable, column, file })
          }
        }
      }

      // A statement terminator bounds attribution to the current ALTER.
      if (line.includes(';')) currentTable = null
    }
  }

  return expected
}

// ── Live probe: does {table}.{column} exist? ───────────────────────────────
async function probeColumn(baseUrl, key, table, column) {
  const url = `${baseUrl}/rest/v1/${table}?select=${encodeURIComponent(column)}&limit=1`
  let res
  try {
    res = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
  } catch (err) {
    return { status: 'network', detail: err.message }
  }
  if (res.ok) return { status: 'ok' }

  let body = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body */
  }
  if (body.code === '42703') return { status: 'missing_column', detail: body.message }
  if (body.code === '42P01') return { status: 'missing_table', detail: body.message }
  return { status: 'error', detail: body.message || `HTTP ${res.status}`, http: res.status }
}

// ── Migration parser: extract { index, table, file } for every CREATE INDEX ──
// Unlike the column parser this runs over whole-file text, not line-by-line:
// real statements wrap (`CREATE UNIQUE INDEX ... \n  ON trades (...)`).
//
// Comments are stripped first. Prose mentioning "CREATE INDEX" is already
// harmless (the mandatory ON clause won't match), but a COMMENTED-OUT statement
// parses perfectly — and would demand an index nobody intends to create, with
// no way to tell from the output that the migration never meant to add it.
function parseExpectedIndexes() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const expected = [] // { index, table, file }
  const seen = new Set()

  const indexRe =
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s+on\s+(?:only\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi

  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n')

    let m
    indexRe.lastIndex = 0
    while ((m = indexRe.exec(text)) !== null) {
      const index = m[1].toLowerCase()
      if (seen.has(index)) continue
      seen.add(index)
      expected.push({ index, table: m[2].toLowerCase(), file })
    }
  }

  return expected
}

// ── Live probe: which indexes exist on the public schema? ──────────────────
// Routes through the schema_index_names() helper; PostgREST can't read
// pg_indexes directly. PGRST202 means the helper itself was never applied.
async function fetchLiveIndexes(baseUrl, key) {
  let res
  try {
    res = await fetch(`${baseUrl}/rest/v1/rpc/schema_index_names`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  } catch (err) {
    return { status: 'network', detail: err.message }
  }

  if (res.ok) {
    const names = await res.json()
    return { status: 'ok', names: new Set(names.map((n) => String(n).toLowerCase())) }
  }

  let body = {}
  try {
    body = await res.json()
  } catch {
    /* non-JSON error body */
  }
  if (body.code === 'PGRST202' || res.status === 404) {
    return { status: 'missing_function', detail: body.message || 'schema_index_names() not found' }
  }
  return { status: 'error', detail: body.message || `HTTP ${res.status}`, http: res.status }
}

// The file that defines schema_index_names(). Named here so a missing helper
// reports like any other unapplied migration instead of a tooling error.
const INTROSPECTOR_FILE = 'add_schema_index_introspection.sql'

async function main() {
  const env = loadEnv()
  const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY

  if (!baseUrl || !key) {
    console.error(
      c.red('✗ Missing env.') +
        ' Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY' +
        ' (from .env.local or the environment).',
    )
    process.exit(1)
  }

  const expected = parseExpectedColumns()
  const expectedIndexes = parseExpectedIndexes()
  console.log(
    c.bold('Schema drift check') +
      c.dim(
        ` — ${expected.length} migration-added columns, ${expectedIndexes.length} indexes` +
          ' across the live DB\n',
      ),
  )

  const [results, live] = await Promise.all([
    Promise.all(
      expected.map(async (e) => ({ ...e, ...(await probeColumn(baseUrl, key, e.table, e.column)) })),
    ),
    fetchLiveIndexes(baseUrl, key),
  ])

  // One round trip answers every index at once, so missing indexes are a plain
  // set difference rather than a probe per name.
  const missingIndexes =
    live.status === 'ok' ? expectedIndexes.filter((e) => !live.names.has(e.index)) : []

  const missingColumns = results.filter((r) => r.status === 'missing_column')
  const missingTables = results.filter((r) => r.status === 'missing_table')
  const errors = results.filter((r) => r.status === 'error' || r.status === 'network')
  const ok = results.filter((r) => r.status === 'ok')

  // Per-table summary (terse — silent-when-clean ethos).
  const byTable = {}
  for (const r of results) (byTable[r.table] ??= []).push(r)
  for (const table of Object.keys(byTable).sort()) {
    const rows = byTable[table]
    const bad = rows.filter((r) => r.status !== 'ok').length
    const label = bad === 0 ? c.green('✓') : c.red('✗')
    console.log(`  ${label} ${table} ${c.dim(`(${rows.length - bad}/${rows.length})`)}`)
  }

  // Indexes are schema-wide, not per-table — one line, same terse shape.
  if (live.status === 'ok') {
    const present = expectedIndexes.length - missingIndexes.length
    const label = missingIndexes.length === 0 ? c.green('✓') : c.red('✗')
    console.log(`  ${label} indexes ${c.dim(`(${present}/${expectedIndexes.length})`)}`)
  } else {
    console.log(`  ${c.yellow('?')} indexes ${c.dim('(not checked)')}`)
  }

  // An absent helper is drift like any other: unverified is not verified. It
  // reports as a missing function rather than 8 missing indexes, because we
  // genuinely don't know whether those indexes are there.
  const introspectorMissing = live.status === 'missing_function'
  const indexCheckFailed = live.status === 'error' || live.status === 'network'

  if (
    missingColumns.length ||
    missingTables.length ||
    errors.length ||
    missingIndexes.length ||
    introspectorMissing ||
    indexCheckFailed
  ) {
    console.log('\n' + c.red(c.bold('Drift detected — apply the missing migrations:\n')))

    // Group missing columns AND indexes by the .sql file that adds them, so a
    // migration that adds both shows up once with every gap it would close.
    const byFile = {}
    for (const r of missingColumns) (byFile[r.file] ??= []).push(`${r.table}.${r.column}`)
    for (const r of missingIndexes) (byFile[r.file] ??= []).push(`index ${r.index} on ${r.table}`)
    if (introspectorMissing) {
      ;(byFile[INTROSPECTOR_FILE] ??= []).push(
        `function schema_index_names() — ${expectedIndexes.length} indexes left unverified`,
      )
    }
    for (const file of Object.keys(byFile).sort()) {
      console.log(`  ${c.yellow('→ supabase/' + file)}`)
      for (const item of byFile[file]) console.log(`      ${c.red('missing')} ${item}`)
    }

    for (const r of missingTables) {
      console.log(`  ${c.red('missing table')} ${r.table} ${c.dim(`(from ${r.file})`)}`)
    }
    for (const r of errors) {
      console.log(
        `  ${c.red('error')} ${r.table}.${r.column} — ${r.detail} ${c.dim(`(${r.file})`)}`,
      )
    }
    if (indexCheckFailed) {
      console.log(`  ${c.red('error')} index check — ${live.detail}`)
    }

    console.log(
      '\n' +
        c.dim('Run the file(s) above in the Supabase dashboard → SQL editor, then re-run this check.'),
    )
    process.exit(1)
  }

  // Only reachable with live.status === 'ok' — every other index status is drift.
  console.log(
    '\n' +
      c.green(
        c.bold(
          `✓ All ${ok.length} migration-added columns and ${expectedIndexes.length} indexes` +
            ' are live. No drift.',
        ),
      ),
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(c.red('✗ Unexpected failure:'), err)
  process.exit(1)
})
