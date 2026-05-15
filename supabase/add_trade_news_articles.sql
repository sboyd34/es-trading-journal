-- ============================================================
-- Store the news articles that triggered a trade's "news driven" tag.
-- Run once in Supabase SQL editor.
-- ============================================================
-- Each entry in news_articles is:
--   { title, source, url, publishedAt, impact }
-- Captured at import time from polygon.io news. Used so trade review
-- shows WHICH headline fired, not just that one did.

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS news_articles JSONB;
