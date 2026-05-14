import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Trade, ApexAccount } from '@/types'
import ApexClient from '@/components/apex/ApexClient'

export default async function ApexPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Try to fetch accounts — table may not exist if migration hasn't been run
  const { data: accountsData, error: accountsError } = await supabase
    .from('apex_accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true, nullsFirst: false })

  // 42P01 = relation does not exist (table not created yet)
  const tableReady = accountsError?.code !== '42P01' && accountsError?.message?.includes('does not exist') !== true

  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user.id)
    .order('entry_time', { ascending: true })

  return (
    <ApexClient
      userId={user.id}
      initialAccounts={(accountsData as ApexAccount[]) ?? []}
      initialTrades={(trades as Trade[]) ?? []}
      tableReady={tableReady}
    />
  )
}
