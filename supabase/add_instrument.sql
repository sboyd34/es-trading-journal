-- Migration: Add multi-instrument support
-- Run this against your Supabase database via the SQL editor.

-- 1. Add instrument column (defaults to 'ES' for existing trades)
ALTER TABLE trades ADD COLUMN IF NOT EXISTS instrument text NOT NULL DEFAULT 'ES';

-- 2. Drop the hardcoded ES generated columns
ALTER TABLE trades DROP COLUMN IF EXISTS gross_pnl;
ALTER TABLE trades DROP COLUMN IF EXISTS net_pnl;

-- 3. Re-add with instrument-aware multipliers
--    ES: $50/pt  |  NQ: $20/pt  |  MES: $5/pt  |  MNQ: $2/pt
ALTER TABLE trades
  ADD COLUMN gross_pnl numeric GENERATED ALWAYS AS (
    (exit_price - entry_price) * quantity *
    CASE instrument
      WHEN 'NQ'  THEN 20
      WHEN 'MES' THEN 5
      WHEN 'MNQ' THEN 2
      ELSE 50
    END * CASE direction WHEN 'long' THEN 1 ELSE -1 END
  ) STORED;

ALTER TABLE trades
  ADD COLUMN net_pnl numeric GENERATED ALWAYS AS (
    (exit_price - entry_price) * quantity *
    CASE instrument
      WHEN 'NQ'  THEN 20
      WHEN 'MES' THEN 5
      WHEN 'MNQ' THEN 2
      ELSE 50
    END * CASE direction WHEN 'long' THEN 1 ELSE -1 END - commission
  ) STORED;
