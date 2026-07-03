-- ============================================================
-- MAE/MFE excursion tracking + loss classification on trades.
-- Run once in the Supabase SQL editor.
-- ============================================================
-- Excursions are stored in TICKS (MES/ES tick = 0.25 pts). These are
-- distinct from the legacy point-based `mae`/`mfe` columns and are
-- populated by the Polygon 1-min enrichment step (import + backfill).
--
--   mae_ticks         Max Adverse Excursion, in ticks (>= 0), null until computed
--   mfe_ticks         Max Favorable Excursion, in ticks (>= 0), null until computed
--   excursion_source  'polygon_1min' | 'polygon_1min_edgebar' — data provenance
--   loss_type         'straight_loss' | 'reversal_loss' — null for winners/scratches
--   excursion_status  'pending' | 'complete' | 'failed' | 'no_data'

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS mae_ticks INTEGER,
  ADD COLUMN IF NOT EXISTS mfe_ticks INTEGER,
  ADD COLUMN IF NOT EXISTS excursion_source TEXT,
  ADD COLUMN IF NOT EXISTS loss_type TEXT,
  ADD COLUMN IF NOT EXISTS excursion_status TEXT NOT NULL DEFAULT 'pending';

-- Lets the enrichment step find unprocessed trades cheaply (resumable backfill).
CREATE INDEX IF NOT EXISTS trades_excursion_status_idx
  ON trades(user_id, excursion_status);
