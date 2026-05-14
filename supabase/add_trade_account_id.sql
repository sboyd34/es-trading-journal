-- ============================================================
-- Scope journal trades to a specific Apex account.
-- Run once in Supabase SQL editor.
-- ============================================================
-- Adds:
--   - apex_accounts.broker_account_id : the Tradovate account label
--     (e.g. "PA12345" or "APEX-50K-EVAL-7") used to auto-match imported
--     fills to a journal account.
--   - trades.account_id : nullable FK → apex_accounts. ON DELETE SET NULL
--     so deleting an account orphans its trades rather than destroying them.

ALTER TABLE apex_accounts
  ADD COLUMN IF NOT EXISTS broker_account_id TEXT;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES apex_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trades_account_id ON trades(account_id);
