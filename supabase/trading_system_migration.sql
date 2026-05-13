-- Add five-word gate fields to trades table
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS trade_bias text,
  ADD COLUMN IF NOT EXISTS trade_setup text,
  ADD COLUMN IF NOT EXISTS trade_trigger text,
  ADD COLUMN IF NOT EXISTS trade_location text,
  ADD COLUMN IF NOT EXISTS trade_risk text;
