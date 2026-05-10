import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Trade, RiskRules, DailySession } from '@/types'
import DashboardClient from './DashboardClient'
import { format } from 'date-fns'

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = format(new Date(), 'yyyy-MM-dd')

  // Fetch all trades
  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user.id)
    .order('entry_time', { ascending: true })

  // Fetch today's trades
  const { data: todayTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .order('entry_time', { ascending: true })

  // Fetch risk rules
  const { data: riskRulesData } = await supabase
    .from('risk_rules')
    .select('*')
    .eq('user_id', user.id)
    .single()

  // Fetch today's session
  const { data: sessionData } = await supabase
    .from('daily_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .single()

  const defaultRiskRules: RiskRules = {
    id: '',
    user_id: user.id,
    max_daily_loss: 500,
    max_trades: 6,
    max_consecutive_losses: 3,
    default_risk: 100,
  }

  return (
    <DashboardClient
      trades={(trades as Trade[]) || []}
      todayTrades={(todayTrades as Trade[]) || []}
      riskRules={(riskRulesData as RiskRules) || defaultRiskRules}
      session={(sessionData as DailySession) || null}
    />
  )
}
