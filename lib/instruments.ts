// Dollars per point, keyed off `trades.instrument`.
//
// This module is deliberately dependency-free. It used to live in
// tradovate-parser.ts, which imports papaparse — so every page that needed
// nothing but this four-entry table dragged a CSV parser into its bundle
// (confirmed: papaparse lands in a client chunk). Four separate copies had
// also accumulated across the codebase, and one of them drifted to a
// hardcoded ES 50 and quietly reported MES R-multiples 10x too small.
//
// Import from here. Do not re-declare these rates locally.
//
// Postgres is the actual source of truth: `gross_pnl` / `net_pnl` on `trades`
// are generated columns keyed off the same mapping (see add_instrument.sql).
// This table is for client-side derived math only — never recompute stored
// P&L with it. If the two ever disagree, Postgres wins and this is the bug.
export const POINT_VALUES: Record<string, number> = {
  ES: 50,
  NQ: 20,
  MES: 5,
  MNQ: 2,
}
