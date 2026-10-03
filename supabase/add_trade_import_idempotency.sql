-- Make Tradovate imports idempotent.
--
-- Why: the journal was silently missing a trade (MES round turn
-- 602461190807_602461190826) because it fell in the seam between two import
-- batches. Because tradovate_order_id had no unique constraint and both write
-- paths used a bare INSERT, re-importing an overlapping CSV created duplicate
-- trades. That forced hand-picked, non-overlapping export windows -- and any
-- gap between those windows dropped trades with no warning.
--
-- With this index, re-importing the widest available CSV is always safe:
-- already-known trades are skipped, gaps self-heal.
--
-- Scoped per user so two users importing the same broker fills don't collide.
-- Deliberately NOT a partial index (no `WHERE tradovate_order_id IS NOT NULL`):
-- Postgres unique indexes are NULLS DISTINCT by default, so manually-entered
-- trades with a NULL order id are already unconstrained -- and a partial index
-- cannot be inferred by PostgREST's on_conflict= parameter, which would break
-- the upsert at runtime.

CREATE UNIQUE INDEX IF NOT EXISTS trades_user_tradovate_order_id_key
  ON trades (user_id, tradovate_order_id);
