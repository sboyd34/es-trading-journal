-- supabase/add_first_target_hit.sql
-- Adds first_target_hit to trades: did the first contract reach take profit
-- before the position was closed or stopped? Recorded by hand on the
-- annotation form, since TP1 is a bracket fill the journal never sees.
--
-- Deliberately nullable with no default: NULL means "not recorded" and keeps
-- every pre-existing trade out of the stat instead of silently scoring it as
-- a miss. Only true/false count toward a TP1 hit rate.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS first_target_hit boolean;
