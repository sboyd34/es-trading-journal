-- Migration: daily_briefs table for auto-imported morning briefs
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS daily_briefs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  brief_text  text        NOT NULL,
  plan_json   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS daily_briefs_user_id_date_idx ON daily_briefs(user_id, date);

ALTER TABLE daily_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily briefs"
  ON daily_briefs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own daily briefs"
  ON daily_briefs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own daily briefs"
  ON daily_briefs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own daily briefs"
  ON daily_briefs FOR DELETE
  USING (auth.uid() = user_id);
