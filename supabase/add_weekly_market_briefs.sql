-- Weekly market brief: the Sunday-generated recap + week-ahead plan.
-- Keyed to the MONDAY of the week the brief DESCRIBES, not the Sunday it was
-- generated, so the journal can look it up by the week the trader is planning.
CREATE TABLE IF NOT EXISTS weekly_market_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  brief_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start_date)
);

ALTER TABLE weekly_market_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own weekly market briefs"
  ON weekly_market_briefs FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own weekly market briefs"
  ON weekly_market_briefs FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own weekly market briefs"
  ON weekly_market_briefs FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own weekly market briefs"
  ON weekly_market_briefs FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS weekly_market_briefs_user_week_idx
  ON weekly_market_briefs (user_id, week_start_date DESC);
