-- ============================================================
-- Apex multi-account migration
-- Rename `apex_settings` (one row per user) → `apex_accounts`
-- (many rows per user, each with its own name and config).
-- Run once in Supabase SQL editor.
-- ============================================================

-- 1. Rename the table (preserves data, policies, RLS state)
ALTER TABLE IF EXISTS apex_settings RENAME TO apex_accounts;

-- 2. Drop the per-user uniqueness so a user can hold multiple accounts
ALTER TABLE apex_accounts DROP CONSTRAINT IF EXISTS apex_settings_user_id_key;

-- 3. Add a human-readable name column for switching between accounts
ALTER TABLE apex_accounts
  ADD COLUMN IF NOT EXISTS name TEXT;

-- Track creation time so the UI can list accounts in a stable order
ALTER TABLE apex_accounts
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Seed existing rows with a sensible default
UPDATE apex_accounts SET name = 'Account 1' WHERE name IS NULL OR name = '';

ALTER TABLE apex_accounts
  ALTER COLUMN name SET NOT NULL;

-- 4. Ensure (user_id, name) is unique so each account has a stable label
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'apex_accounts_user_id_name_key'
  ) THEN
    ALTER TABLE apex_accounts
      ADD CONSTRAINT apex_accounts_user_id_name_key UNIQUE (user_id, name);
  END IF;
END $$;

-- 5. Rename the RLS policy to match the new table name
DROP POLICY IF EXISTS "Users manage own apex settings" ON apex_accounts;
DROP POLICY IF EXISTS "Users manage own apex accounts" ON apex_accounts;
CREATE POLICY "Users manage own apex accounts"
  ON apex_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
