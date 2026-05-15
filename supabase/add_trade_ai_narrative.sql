-- AI-generated narrative for individual trades. JSON shape:
-- { narrative: string, what_went_right: string[], what_went_wrong: string[], key_lesson: string, generated_at: string }

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS ai_narrative jsonb;
