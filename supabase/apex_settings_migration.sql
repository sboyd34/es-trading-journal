-- Apex Milestone Tracker settings (one row per user)
-- Run this once in the Supabase SQL editor before first use.

CREATE TABLE IF NOT EXISTS apex_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  account_size integer NOT NULL DEFAULT 50000,
  mode text NOT NULL DEFAULT 'evaluation'
    CHECK (mode IN ('evaluation', 'pa')),
  drawdown_type text NOT NULL DEFAULT 'intraday'
    CHECK (drawdown_type IN ('eod', 'intraday')),
  starting_balance numeric NOT NULL DEFAULT 50000,
  current_balance numeric NOT NULL DEFAULT 50000,
  todays_starting_balance numeric NOT NULL DEFAULT 50000,
  highest_balance numeric NOT NULL DEFAULT 50000,
  purchase_date date,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id)
);

ALTER TABLE apex_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own apex settings" ON apex_settings
  FOR ALL USING (auth.uid() = user_id);
