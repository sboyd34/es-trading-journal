-- Let `npm run check:schema` verify indexes, not just columns.
--
-- Why: the drift checker probes columns by asking PostgREST for them — a
-- missing column answers itself with 42703. Indexes have no such tell. They
-- don't change the shape of any response, only the query plan, so an
-- index-only migration (add_trade_import_idempotency.sql) could sit committed
-- and unapplied while the checker reported all green. That is the same silent
-- class of failure the checker exists to kill, just one level down.
--
-- PostgREST can't read pg_indexes directly, so index checks route through this
-- helper instead. Returns bare index names for the public schema; the checker
-- compares them against every CREATE INDEX parsed out of supabase/*.sql.
--
-- Not SECURITY DEFINER on purpose — service_role can already read pg_indexes,
-- so there's no privilege to borrow. EXECUTE is revoked from PUBLIC (Postgres
-- grants it by default) so this never becomes an anon-readable schema listing.

CREATE OR REPLACE FUNCTION public.schema_index_names()
RETURNS SETOF text
LANGUAGE sql
STABLE
AS $$
  SELECT indexname::text
  FROM pg_indexes
  WHERE schemaname = 'public'
$$;

REVOKE EXECUTE ON FUNCTION public.schema_index_names() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.schema_index_names() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_index_names() TO service_role;
