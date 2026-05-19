-- ============================================================
-- Replay Engine — adds bar-by-bar playback + mistake taxonomy
-- Run once in Supabase SQL editor
-- ============================================================

ALTER TABLE blind_backtest_trades
  ADD COLUMN IF NOT EXISTS mistake_type    TEXT,
  ADD COLUMN IF NOT EXISTS mistake_other   TEXT,
  ADD COLUMN IF NOT EXISTS bars_held       INTEGER,
  ADD COLUMN IF NOT EXISTS entry_bar_index INTEGER,
  ADD COLUMN IF NOT EXISTS playback_mode   TEXT NOT NULL DEFAULT 'B';
