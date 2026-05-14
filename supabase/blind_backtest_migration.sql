-- ============================================================
-- Blind Backtest Engine — run once in Supabase SQL editor
-- ============================================================

CREATE TABLE IF NOT EXISTS blind_backtest_sessions (
  id                   UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  setup_filter         TEXT         NOT NULL DEFAULT 'All',
  time_window_filter   TEXT         NOT NULL DEFAULT 'All',
  total_trades_planned INTEGER      NOT NULL DEFAULT 10,
  wins                 INTEGER      NOT NULL DEFAULT 0,
  losses               INTEGER      NOT NULL DEFAULT 0,
  scratches            INTEGER      NOT NULL DEFAULT 0,
  avg_r_multiple       NUMERIC,
  ai_session_note      TEXT,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE blind_backtest_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own blind sessions"
  ON blind_backtest_sessions FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blind_backtest_trades (
  id                UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id        UUID         REFERENCES blind_backtest_sessions(id) ON DELETE CASCADE,
  historical_date   DATE         NOT NULL,
  instrument        TEXT         NOT NULL DEFAULT 'ES',
  contract_type     TEXT         NOT NULL DEFAULT 'ES',
  chart_cutoff_time TEXT         NOT NULL,
  trade_bias        TEXT,
  trade_setup       TEXT,
  trade_trigger     TEXT,
  trade_location    TEXT,
  trade_risk        TEXT,
  entry_price       NUMERIC      NOT NULL,
  stop_price        NUMERIC      NOT NULL,
  target_price      NUMERIC      NOT NULL,
  direction         TEXT         NOT NULL,
  confidence        INTEGER,
  outcome           TEXT,        -- WIN | LOSS | SCRATCH
  gross_pnl         NUMERIC,
  r_multiple        NUMERIC,
  ai_grade          TEXT,        -- A | B | C
  ai_feedback       TEXT,
  self_grade        TEXT,        -- A | B | C
  mood              TEXT,
  notes             TEXT,
  reflection        TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE blind_backtest_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own blind trades"
  ON blind_backtest_trades FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
