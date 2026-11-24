-- supabase/add_second_target_hit.sql
-- Adds second_target_hit to trades: did the SECOND contract of the 2-MES
-- bracket reach its take profit (+32t), or was it stopped at breakeven after
-- leg 1 filled? Recorded by hand on the annotation form, asked only when
-- first_target_hit is true — leg 2's target lies beyond leg 1's, so a leg-2
-- answer without a leg-1 fill is meaningless.
--
-- Same contract as first_target_hit: nullable, no default. NULL means "not
-- recorded" (or leg 1 never filled) and keeps those trades out of a TP2 hit
-- rate instead of scoring them as misses.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS second_target_hit boolean;
