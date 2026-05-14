-- ============================================================
-- Add chart screenshot column to blind_backtest_trades
-- Run once in Supabase SQL editor.
-- ============================================================
-- Reuses the existing `trade-charts` storage bucket (created in
-- add_trade_charts.sql). Path convention for blind trades:
--   {user_id}/blind/{ref_uuid}/chart.{ext}
-- The existing storage RLS policies already check that the first
-- folder is the auth.uid(), so no new bucket policies are needed.

ALTER TABLE blind_backtest_trades
  ADD COLUMN IF NOT EXISTS chart_url TEXT;
