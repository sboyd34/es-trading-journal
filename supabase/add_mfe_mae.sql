-- ============================================================
-- Add MFE / MAE columns to blind_backtest_trades
-- Run once in Supabase SQL editor.
-- ============================================================
-- mfe: max favorable excursion during the trade, in price points (>= 0)
-- mae: max adverse excursion during the trade, in price points (>= 0)
-- Both stored as positive magnitudes; sign is implicit by name.

ALTER TABLE blind_backtest_trades
  ADD COLUMN IF NOT EXISTS mfe NUMERIC,
  ADD COLUMN IF NOT EXISTS mae NUMERIC;
