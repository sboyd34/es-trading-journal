-- Re-stamp legacy commission values using the current ALLIN_FEE_PER_CONTRACT table.
--
-- Why: lib/tradovate-parser.ts ALLIN_FEE_PER_CONTRACT was updated to reconciled
-- values (ES 4.10 / NQ 3.47 / MES 1.01 / MNQ 1.04 round-turn per contract), but
-- trades synced BEFORE that update have stale low commission values stored.
-- That makes net_pnl (the generated column = gross_pnl - commission) appear
-- higher than Tradovate's true net. This migration brings all rows up to the
-- current source-of-truth rates.
--
-- The trades.net_pnl generated column auto-recomputes as soon as commission
-- updates, so no second statement is needed.
--
-- Safe to re-run: it SETs commission to the canonical value derived from
-- instrument + quantity, not an increment.

-- Diff preview (run first if you want to see what will change)
SELECT
  instrument,
  COUNT(*)                                  AS n,
  ROUND(SUM(commission)::numeric, 2)        AS before_commission,
  ROUND(SUM(
    CASE instrument
      WHEN 'ES'  THEN quantity * 4.10
      WHEN 'NQ'  THEN quantity * 3.47
      WHEN 'MES' THEN quantity * 1.01
      WHEN 'MNQ' THEN quantity * 1.04
      ELSE             quantity * 4.10
    END
  )::numeric, 2)                            AS after_commission
FROM trades
GROUP BY instrument
ORDER BY instrument;

-- The actual restamp
UPDATE trades
SET commission = ROUND((
  CASE instrument
    WHEN 'ES'  THEN quantity * 4.10
    WHEN 'NQ'  THEN quantity * 3.47
    WHEN 'MES' THEN quantity * 1.01
    WHEN 'MNQ' THEN quantity * 1.04
    ELSE             quantity * 4.10
  END
)::numeric, 2);

-- Verification: should show sum_net close to Tradovate's reported net
SELECT
  COUNT(*)                              AS total_trades,
  ROUND(SUM(gross_pnl)::numeric,  2)    AS sum_gross,
  ROUND(SUM(commission)::numeric, 2)    AS sum_commission,
  ROUND(SUM(net_pnl)::numeric,    2)    AS sum_net
FROM trades;
