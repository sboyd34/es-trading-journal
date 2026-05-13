-- Tradovate broker sync credentials (password stored AES-256 encrypted server-side)
CREATE TABLE IF NOT EXISTS tradovate_credentials (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users NOT NULL UNIQUE,
  username    text NOT NULL,
  password_enc text NOT NULL,
  device_id   text NOT NULL DEFAULT gen_random_uuid()::text,
  access_token text,
  token_expiry timestamptz,
  last_sync_at timestamptz,
  sync_enabled boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE tradovate_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tradovate credentials"
  ON tradovate_credentials
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
