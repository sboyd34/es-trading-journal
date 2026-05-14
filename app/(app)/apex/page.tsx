import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Trade, ApexSettings } from '@/types'
import ApexClient from '@/components/apex/ApexClient'

export default async function ApexPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Try to fetch apex_settings — may not exist if migration hasn't been run yet
  const { data: settingsData, error: settingsError } = await supabase
    .from('apex_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  // 42P01 = relation does not exist (table not created yet)
  const tableReady = settingsError?.code !== '42P01' && settingsError?.message?.includes('does not exist') !== true

  const { data: trades } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user.id)
    .order('entry_time', { ascending: true })

  return (
    <ApexClient
      userId={user.id}
      initialSettings={(settingsData as ApexSettings) ?? null}
      initialTrades={(trades as Trade[]) ?? []}
      tableReady={tableReady}
    />
  )
}
