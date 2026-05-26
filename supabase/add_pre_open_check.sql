-- supabase/add_pre_open_check.sql
-- Adds the pre_open_check JSONB column to store Pre-Session Ritual
-- attestations (4-item Pre-Open Check + saved_at timestamp).
-- See: docs/superpowers/specs/2026-05-26-preopen-ritual-design.md

ALTER TABLE daily_sessions
  ADD COLUMN IF NOT EXISTS pre_open_check jsonb;
