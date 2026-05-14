export interface Trade {
  id: string
  user_id: string
  date: string
  entry_time: string
  exit_time: string
  direction: 'long' | 'short'
  quantity: number
  entry_price: number
  exit_price: number
  gross_pnl: number
  commission: number
  net_pnl: number
  mood: 'calm' | 'confident' | 'anxious' | 'FOMO' | 'revenge' | 'hesitant' | 'bored' | 'overconfident' | null
  grade: 'A' | 'B' | 'C' | null
  setup_tag: string | null
  mae: number | null
  mfe: number | null
  stop_loss: number | null
  target: number | null
  notes: string | null
  reflection: string | null
  tags: string[]
  instrument: string
  tradovate_order_id: string | null
  entry_chart_url: string | null
  exit_chart_url: string | null
  trade_bias: 'Bull' | 'Bear' | 'Neutral' | null
  trade_setup: string | null
  trade_trigger: string | null
  trade_location: string | null
  trade_risk: string | null
  created_at: string
}

export interface DailySession {
  id: string
  user_id: string
  date: string
  pre_market_brief: PreMarketBrief | null
  end_of_day_summary: EndOfDaySummary | null
  checklist_passed: boolean | null
  emotion_score: number | null
  notes: string | null
  created_at: string
}

export interface PreMarketBrief {
  market_condition: string
  location: string
  day_type_expectation: string
  key_levels: string
  if_then_plan: string
  what_not_to_do: string
  risk_level: string
}

export interface EndOfDaySummary {
  what_happened: string
  trades_review: string
  emotional_state: string
  mistakes: string
  wins: string
  lesson: string
  tomorrow_focus: string
}

export interface RiskRules {
  id: string
  user_id: string
  max_daily_loss: number
  max_trades: number
  max_consecutive_losses: number
  default_risk: number
}

export interface PlaybookSetup {
  id: string
  user_id: string
  name: string
  description: string
  entry_criteria: string
  exit_criteria: string
  tags: string[]
  created_at: string
}

export interface DashboardStats {
  totalPnL: number
  totalGrossPnL: number
  winRate: number
  totalTrades: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  currentStreak: number
  todayPnL: number
  todayGrossPnL: number
}

export interface BacktestSession {
  id: string
  user_id: string
  date: string
  onh: number | null
  onl: number | null
  pdh: number | null
  pdl: number | null
  vwap: number | null
  bias: 'Bull' | 'Bear' | 'Neutral' | null
  notes: string | null
  created_at: string
}

export interface BacktestTrade {
  id: string
  user_id: string
  session_id: string | null
  date: string
  entry_time: string | null
  exit_time: string | null
  direction: 'long' | 'short'
  quantity: number
  entry_price: number
  exit_price: number
  instrument: string
  gross_pnl: number
  commission: number
  net_pnl: number
  stop_loss: number | null
  target: number | null
  mae: number | null
  mfe: number | null
  mood: string | null
  grade: 'A' | 'B' | 'C' | null
  setup_tag: string | null
  notes: string | null
  reflection: string | null
  tags: string[]
  trade_bias: 'Bull' | 'Bear' | 'Neutral' | null
  trade_setup: string | null
  trade_trigger: string | null
  trade_location: string | null
  trade_risk: string | null
  created_at: string
}

export interface ChecklistItem {
  id: string
  user_id: string
  label: string
  order_index: number
  created_at: string
}

export interface ApexSettings {
  id: string
  user_id: string
  account_size: number
  mode: 'evaluation' | 'pa'
  drawdown_type: 'eod' | 'intraday'
  starting_balance: number
  current_balance: number
  todays_starting_balance: number
  highest_balance: number
  purchase_date: string | null
  updated_at: string
}

export interface BlindBacktestSession {
  id: string
  user_id: string
  setup_filter: string
  time_window_filter: string
  total_trades_planned: number
  wins: number
  losses: number
  scratches: number
  avg_r_multiple: number | null
  ai_session_note: string | null
  completed_at: string | null
  created_at: string
}

export interface BlindBacktestTrade {
  id: string
  user_id: string
  session_id: string | null
  historical_date: string
  instrument: string
  contract_type: string
  chart_cutoff_time: string
  trade_bias: string | null
  trade_setup: string | null
  trade_trigger: string | null
  trade_location: string | null
  trade_risk: string | null
  entry_price: number
  stop_price: number
  target_price: number
  direction: string
  confidence: number | null
  outcome: 'WIN' | 'LOSS' | 'SCRATCH' | null
  gross_pnl: number | null
  r_multiple: number | null
  ai_grade: 'A' | 'B' | 'C' | null
  ai_feedback: string | null
  self_grade: 'A' | 'B' | 'C' | null
  mood: string | null
  notes: string | null
  reflection: string | null
  created_at: string
}
