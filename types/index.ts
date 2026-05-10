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
  tradovate_order_id: string | null
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
  winRate: number
  totalTrades: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  currentStreak: number
  todayPnL: number
}

export interface ChecklistItem {
  id: string
  user_id: string
  label: string
  order_index: number
  created_at: string
}
