-- Structured companion to weekly_market_briefs.brief_text.
--
-- Mirrors daily_briefs.plan_json (daily_briefs_migration.sql) so the weekly
-- cards can reuse the daily BriefCard rendering path. Nullable on purpose:
-- brief_text stays the source of truth, and a brief posted before this column
-- existed -- or one whose week-ahead half failed to build -- is a valid row
-- with no plan_json. /pre-market is silent-when-clean, so absent renders as
-- nothing rather than as empty cards.
--
-- Shape is flat: one key per brief section, each a rendered string
-- (structural_tilt, level_map, catalysts, expected_range, scenario_paths,
-- volatility_regime, playbook_fit). Deliberately not nested -- the cards
-- render prose, and a flat shape keeps this from becoming a second schema to
-- migrate whenever a section's internals change.
--
-- Run this in the Supabase SQL editor.

ALTER TABLE weekly_market_briefs
  ADD COLUMN IF NOT EXISTS plan_json jsonb;
