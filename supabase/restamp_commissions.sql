-- ############################################################################
-- ## DO NOT RUN. The rates below are DISPROVEN. Kept only as a record.       ##
-- ############################################################################
--
-- This migration would restamp every commission to ES 4.10 / NQ 3.47 /
-- MES 1.01 / MNQ 1.04, which its original header called the "reconciled,
-- source-of-truth" table.
--
-- Those rates are wrong for this account. Reconciled 2026-07-30 against a real
-- Tradovate Performance export (9 round turns, reported net $489.24):
--
--     stored rates  ES 3.10 / MES 1.04  ->  net 489.24   MATCHES Tradovate
--     this file's   ES 4.10 / MES 1.01  ->  net 479.81   off by $9.43
--
-- Running this UPDATE against correct data would have introduced the very
-- discrepancy it was written to fix. The verified rates now live in
-- lib/tradovate-parser.ts ALLIN_FEE_PER_CONTRACT, which both import paths
-- resolve through via feeForContracts().
--
-- An audit of all 21 stored trades found 0 rows at a non-verified rate, so
-- there is nothing to restamp. If a future commission-plan change ever does
-- require one, write a fresh migration against the current table rather than
-- reviving this one.
--
-- The original UPDATE is left commented out deliberately: this directory is
-- pasted into the Supabase SQL editor by hand, and an executable file named
-- "restamp_commissions.sql" sitting here is a loaded gun.

-- Read-only audit: which stored rows disagree with the verified rates?
-- (Expected result: zero rows.)
SELECT
  instrument,
  quantity,
  commission,
  ROUND((commission / NULLIF(quantity, 0))::numeric, 2) AS implied_rate_per_contract
FROM trades
WHERE ROUND((commission / NULLIF(quantity, 0))::numeric, 2) <> CASE instrument
        WHEN 'ES'  THEN 3.10
        WHEN 'NQ'  THEN 3.47
        WHEN 'MES' THEN 1.04
        WHEN 'MNQ' THEN 1.04
        ELSE            3.10
      END
ORDER BY instrument, quantity;

-- -- DISPROVEN — intentionally not executable.
-- UPDATE trades
-- SET commission = ROUND((
--   CASE instrument
--     WHEN 'ES'  THEN quantity * 4.10
--     WHEN 'NQ'  THEN quantity * 3.47
--     WHEN 'MES' THEN quantity * 1.01
--     WHEN 'MNQ' THEN quantity * 1.04
--     ELSE             quantity * 4.10
--   END
-- )::numeric, 2);
