-- supabase/add_discipline_score.sql
ALTER TABLE daily_sessions
  ADD COLUMN IF NOT EXISTS discipline_score int CHECK (discipline_score >= 0 AND discipline_score <= 100),
  ADD COLUMN IF NOT EXISTS discipline_breakdown jsonb;
