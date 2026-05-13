-- Remove DEFAULT 0 from commission so a missing/null value causes an explicit
-- insert error rather than silently storing 0 and producing wrong net_pnl.
-- Run this once in the Supabase SQL editor.
ALTER TABLE trades ALTER COLUMN commission DROP DEFAULT;
