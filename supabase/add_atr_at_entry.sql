-- supabase/add_atr_at_entry.sql
-- Adds atr_at_entry to trades: the ATR reading at the moment the trade was
-- taken, entered by hand on the annotation form alongside MAE/MFE.
-- Stored in points (same unit as mae/mfe/stop_loss/target) so stop distance
-- can be expressed as a multiple of ATR without a unit conversion.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS atr_at_entry numeric;
