-- ES Trading Journal Schema

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  username text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  entry_time timestamptz NOT NULL,
  exit_time timestamptz NOT NULL,
  direction text NOT NULL CHECK (direction IN ('long', 'short')),
  quantity int NOT NULL DEFAULT 1,
  entry_price numeric NOT NULL,
  exit_price numeric NOT NULL,
  gross_pnl numeric GENERATED ALWAYS AS (
    (exit_price - entry_price) * quantity * 50 * CASE direction WHEN 'long' THEN 1 ELSE -1 END
  ) STORED,
  commission numeric NOT NULL DEFAULT 0,
  net_pnl numeric GENERATED ALWAYS AS (
    (exit_price - entry_price) * quantity * 50 * CASE direction WHEN 'long' THEN 1 ELSE -1 END - commission
  ) STORED,
  mood text CHECK (mood IN ('calm', 'confident', 'anxious', 'FOMO', 'revenge', 'hesitant', 'bored', 'overconfident')),
  grade text CHECK (grade IN ('A', 'B', 'C')),
  setup_tag text,
  mae numeric,
  mfe numeric,
  stop_loss numeric,
  target numeric,
  notes text,
  reflection text,
  tags text[] DEFAULT '{}',
  tradovate_order_id text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Daily sessions table
CREATE TABLE IF NOT EXISTS daily_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  pre_market_brief jsonb,
  end_of_day_summary jsonb,
  checklist_passed boolean,
  emotion_score int CHECK (emotion_score >= 1 AND emotion_score <= 10),
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id, date)
);

-- Risk rules table
CREATE TABLE IF NOT EXISTS risk_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  max_daily_loss numeric NOT NULL DEFAULT 500,
  max_trades int NOT NULL DEFAULT 6,
  max_consecutive_losses int NOT NULL DEFAULT 3,
  default_risk numeric NOT NULL DEFAULT 100,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (user_id)
);

-- Playbook setups table
CREATE TABLE IF NOT EXISTS playbook_setups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  entry_criteria text,
  exit_criteria text,
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Checklist items table
CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label text NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS trades_user_id_date_idx ON trades(user_id, date);
CREATE INDEX IF NOT EXISTS daily_sessions_user_id_date_idx ON daily_sessions(user_id, date);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trades policies
CREATE POLICY "Users can view own trades"
  ON trades FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trades"
  ON trades FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trades"
  ON trades FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own trades"
  ON trades FOR DELETE
  USING (auth.uid() = user_id);

-- Daily sessions policies
CREATE POLICY "Users can view own sessions"
  ON daily_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON daily_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON daily_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON daily_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Risk rules policies
CREATE POLICY "Users can view own risk rules"
  ON risk_rules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own risk rules"
  ON risk_rules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own risk rules"
  ON risk_rules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own risk rules"
  ON risk_rules FOR DELETE
  USING (auth.uid() = user_id);

-- Playbook setups policies
CREATE POLICY "Users can view own playbook setups"
  ON playbook_setups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own playbook setups"
  ON playbook_setups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own playbook setups"
  ON playbook_setups FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own playbook setups"
  ON playbook_setups FOR DELETE
  USING (auth.uid() = user_id);

-- Checklist items policies
CREATE POLICY "Users can view own checklist items"
  ON checklist_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own checklist items"
  ON checklist_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own checklist items"
  ON checklist_items FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own checklist items"
  ON checklist_items FOR DELETE
  USING (auth.uid() = user_id);

-- Function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.risk_rules (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
