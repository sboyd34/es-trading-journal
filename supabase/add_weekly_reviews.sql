-- Weekly AI review summaries — one per (user, week_start_date).
-- week_start_date is the Monday of the trading week (ISO Monday-start).

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  week_end_date date NOT NULL,
  review jsonb NOT NULL,
  trade_count int NOT NULL DEFAULT 0,
  total_pnl numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reviews_user_week
  ON weekly_reviews (user_id, week_start_date DESC);

ALTER TABLE weekly_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own weekly reviews" ON weekly_reviews;
CREATE POLICY "Users manage own weekly reviews" ON weekly_reviews
  FOR ALL USING (auth.uid() = user_id);
