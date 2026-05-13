-- Backtest sessions (one per date per user)
CREATE TABLE IF NOT EXISTS backtest_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date date NOT NULL,
  onh numeric,
  onl numeric,
  pdh numeric,
  pdl numeric,
  vwap numeric,
  bias text,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, date)
);

-- Backtest trades (separate from live trades)
CREATE TABLE IF NOT EXISTS backtest_trades (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid REFERENCES backtest_sessions(id) ON DELETE SET NULL,
  date date NOT NULL,
  entry_time text,
  exit_time text,
  direction text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  entry_price numeric NOT NULL,
  exit_price numeric NOT NULL,
  instrument text NOT NULL DEFAULT 'ES',
  gross_pnl numeric NOT NULL DEFAULT 0,
  commission numeric NOT NULL DEFAULT 0,
  net_pnl numeric NOT NULL DEFAULT 0,
  stop_loss numeric,
  target numeric,
  mae numeric,
  mfe numeric,
  mood text,
  grade text,
  setup_tag text,
  notes text,
  reflection text,
  tags text[] DEFAULT '{}',
  trade_bias text,
  trade_setup text,
  trade_trigger text,
  trade_location text,
  trade_risk text,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE backtest_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own backtest sessions" ON backtest_sessions
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own backtest trades" ON backtest_trades
  FOR ALL USING (auth.uid() = user_id);
