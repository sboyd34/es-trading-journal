'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RiskRules, ChecklistItem, Trade } from '@/types'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { Plus, Trash2, GripVertical, Download, Search, Bell, BellOff, RotateCcw, Wifi, WifiOff, RefreshCw, Unplug } from 'lucide-react'
import { STORAGE_KEY as NOTIF_KEY } from '@/components/dashboard/SessionCloseNotifier'
import { format, parseISO } from 'date-fns'
import { SYSTEM_CHECKLIST_ITEMS } from '@/lib/trading-system'

const POST_LOSS_KEY = 'post_loss_day'
const ACCOUNT_TYPE_KEY = 'apex_account_type'

const APEX_PRESETS = {
  Evaluation: { maxDailyLoss: '250', softStop: '150', defaultRisk: '100' },
  PA: { maxDailyLoss: '150', softStop: '120', defaultRisk: '60' },
}

export default function SettingsPage() {
  const [riskRules, setRiskRules] = useState<RiskRules | null>(null)
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const [allTrades, setAllTrades] = useState<Trade[]>([])
  const [savingRisk, setSavingRisk] = useState(false)
  const [newChecklistLabel, setNewChecklistLabel] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Trade[]>([])
  const [notifEnabled, setNotifEnabled] = useState(false)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default')
  const [postLossDay, setPostLossDay] = useState(false)
  const [accountType, setAccountType] = useState<'Evaluation' | 'PA' | null>(null)
  const [resetingChecklist, setResetingChecklist] = useState(false)

  // Broker sync state
  type SyncStatus = { connected: boolean; username?: string; lastSync?: string | null; syncEnabled?: boolean }
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [syncLoading, setSyncLoading] = useState(true)
  const [brokerUsername, setBrokerUsername] = useState('')
  const [brokerPassword, setBrokerPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Risk form state
  const [maxDailyLoss, setMaxDailyLoss] = useState('500')
  const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState('3')
  const [defaultRisk, setDefaultRisk] = useState('100')

  const supabase = createClient()

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: rr }, { data: cl }, { data: trades }] = await Promise.all([
      supabase.from('risk_rules').select('*').eq('user_id', user.id).single(),
      supabase.from('checklist_items').select('*').eq('user_id', user.id).order('order_index'),
      supabase.from('trades').select('*').eq('user_id', user.id),
    ])

    if (rr) {
      setRiskRules(rr as RiskRules)
      setMaxDailyLoss(rr.max_daily_loss.toString())
      setMaxConsecutiveLosses(rr.max_consecutive_losses.toString())
      setDefaultRisk(rr.default_risk.toString())
    }

    setChecklistItems((cl as ChecklistItem[]) || [])
    setAllTrades((trades as Trade[]) || [])
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    setNotifEnabled(localStorage.getItem(NOTIF_KEY) === 'true')
    setPostLossDay(localStorage.getItem(POST_LOSS_KEY) === 'true')
    const saved = localStorage.getItem(ACCOUNT_TYPE_KEY) as 'Evaluation' | 'PA' | null
    setAccountType(saved)
    if (typeof Notification !== 'undefined') {
      setNotifPermission(Notification.permission)
    }
  }, [])

  function handleAccountTypeSelect(type: 'Evaluation' | 'PA') {
    const preset = APEX_PRESETS[type]
    setAccountType(type)
    setMaxDailyLoss(preset.maxDailyLoss)
    setDefaultRisk(preset.defaultRisk)
    localStorage.setItem(ACCOUNT_TYPE_KEY, type)
    toast.success(`${type} risk rules applied`)
  }

  function handlePostLossToggle() {
    const next = !postLossDay
    setPostLossDay(next)
    localStorage.setItem(POST_LOSS_KEY, next ? 'true' : 'false')
    toast.success(next ? 'Post-loss day active — half base size today' : 'Post-loss day cleared')
  }

  async function handleResetChecklist() {
    setResetingChecklist(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      await supabase.from('checklist_items').delete().eq('user_id', user.id)
      const rows = SYSTEM_CHECKLIST_ITEMS.map((label, i) => ({
        user_id: user.id,
        label,
        order_index: i,
      }))
      const { data, error } = await supabase.from('checklist_items').insert(rows).select()
      if (error) throw error
      setChecklistItems((data as ChecklistItem[]) || [])
      toast.success('Checklist reset to system defaults')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setResetingChecklist(false)
    }
  }

  async function handleNotifToggle() {
    if (!notifEnabled) {
      if (typeof Notification === 'undefined') {
        toast.error('Notifications are not supported in this browser')
        return
      }
      if (Notification.permission === 'denied') {
        toast.error('Notifications are blocked — allow them in your browser settings first')
        return
      }
      if (Notification.permission !== 'granted') {
        const result = await Notification.requestPermission()
        setNotifPermission(result)
        if (result !== 'granted') {
          toast.error('Notification permission denied')
          return
        }
      }
      localStorage.setItem(NOTIF_KEY, 'true')
      setNotifEnabled(true)
      toast.success('Session close reminder enabled!')
    } else {
      localStorage.setItem(NOTIF_KEY, 'false')
      setNotifEnabled(false)
      toast.success('Session close reminder disabled')
    }
  }

  async function handleSaveRiskRules() {
    setSavingRisk(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const updates = {
        max_daily_loss: parseFloat(maxDailyLoss) || 500,
        max_consecutive_losses: parseInt(maxConsecutiveLosses) || 3,
        default_risk: parseFloat(defaultRisk) || 100,
      }

      if (riskRules?.id) {
        const { error } = await supabase
          .from('risk_rules')
          .update(updates)
          .eq('id', riskRules.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('risk_rules')
          .insert({ user_id: user.id, ...updates })
        if (error) throw error
      }

      toast.success('Risk rules saved!')
      loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingRisk(false)
    }
  }

  async function handleAddChecklistItem() {
    if (!newChecklistLabel.trim()) {
      toast.error('Please enter a checklist item')
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('checklist_items')
      .insert({
        user_id: user.id,
        label: newChecklistLabel.trim(),
        order_index: checklistItems.length,
      })
      .select()
      .single()

    if (error) {
      toast.error(error.message)
      return
    }

    setChecklistItems((prev) => [...prev, data as ChecklistItem])
    setNewChecklistLabel('')
    toast.success('Item added')
  }

  async function handleDeleteChecklistItem(id: string) {
    const { error } = await supabase.from('checklist_items').delete().eq('id', id)
    if (error) {
      toast.error(error.message)
      return
    }
    setChecklistItems((prev) => prev.filter((item) => item.id !== id))
    toast.success('Item removed')
  }

  function handleExportCSV() {
    window.open('/api/export/csv', '_blank')
  }

  // Live search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const q = searchQuery.toLowerCase()
    const results = allTrades.filter((t) => {
      const notes = (t.notes || '').toLowerCase()
      const reflection = (t.reflection || '').toLowerCase()
      const tags = (t.tags || []).join(' ').toLowerCase()
      const setup = (t.setup_tag || '').toLowerCase()
      return notes.includes(q) || reflection.includes(q) || tags.includes(q) || setup.includes(q)
    })
    setSearchResults(results.slice(0, 10))
  }, [searchQuery, allTrades])

  // ── Broker sync handlers ──────────────────────────────────────────────────
  const loadSyncStatus = useCallback(async () => {
    setSyncLoading(true)
    try {
      const res = await fetch('/api/tradovate/status')
      const data = await res.json()
      setSyncStatus(data)
    } catch {
      setSyncStatus({ connected: false })
    } finally {
      setSyncLoading(false)
    }
  }, [])

  useEffect(() => { loadSyncStatus() }, [loadSyncStatus])

  async function handleConnect() {
    if (!brokerUsername.trim() || !brokerPassword) return
    setConnecting(true)
    try {
      const res = await fetch('/api/tradovate/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: brokerUsername.trim(), password: brokerPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connection failed')
      toast.success('Connected to Tradovate')
      setBrokerUsername('')
      setBrokerPassword('')
      await loadSyncStatus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Tradovate? Auto-sync will stop.')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/tradovate/disconnect', { method: 'POST' })
      if (!res.ok) throw new Error('Disconnect failed')
      toast.success('Disconnected')
      await loadSyncStatus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed')
    } finally {
      setDisconnecting(false)
    }
  }

  async function handleManualSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/tradovate/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      toast.success(`Sync complete — ${data.inserted ?? 0} new trades imported`)
      await loadSyncStatus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">Configure your journal preferences</p>
      </div>

      {/* Broker Sync */}
      <section className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">Broker Sync</h2>
        <p className="text-xs text-gray-500 mb-4">
          Connects to your Tradovate account for automatic fill sync. Available for Apex PA (funded) accounts.
          Evaluation accounts use CSV import below.
        </p>

        {syncLoading ? (
          <p className="text-sm text-gray-500">Checking connection...</p>
        ) : syncStatus?.connected ? (
          /* ── Connected state ── */
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-emerald-400" />
              <span className="text-sm text-emerald-400 font-medium">Connected</span>
              <span className="text-xs text-gray-500">as {syncStatus.username}</span>
            </div>
            {syncStatus.lastSync && (
              <p className="text-xs text-gray-500">
                Last sync: {new Date(syncStatus.lastSync).toLocaleString()}
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleManualSync}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm font-semibold rounded-lg transition"
              >
                <Unplug className="h-3.5 w-3.5" />
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        ) : (
          /* ── Connect form ── */
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <WifiOff className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-500">Not connected</span>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Tradovate Username</label>
              <input
                type="text"
                value={brokerUsername}
                onChange={(e) => setBrokerUsername(e.target.value)}
                placeholder="your@email.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Password</label>
              <input
                type="password"
                value={brokerPassword}
                onChange={(e) => setBrokerPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={handleConnect}
              disabled={connecting || !brokerUsername.trim() || !brokerPassword}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
            >
              <Wifi className="h-3.5 w-3.5" />
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        )}
      </section>

      {/* Apex Account Type */}
      <section className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">Apex Account Type</h2>
        <p className="text-xs text-gray-500 mb-4">Select your account type to auto-populate Apex 50K risk rules.</p>
        <div className="flex gap-3 mb-5">
          {(['Evaluation', 'PA'] as const).map((type) => (
            <button
              key={type}
              onClick={() => handleAccountTypeSelect(type)}
              className={cn(
                'flex-1 py-2.5 rounded-lg border text-sm font-semibold transition',
                accountType === type
                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                  : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'
              )}
            >
              {type}
            </button>
          ))}
        </div>
        {accountType && (
          <div className="grid grid-cols-2 gap-3 text-xs mb-5">
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-500 mb-0.5">Hard Stop</p>
              <p className="text-white font-semibold">-${APEX_PRESETS[accountType].maxDailyLoss}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-500 mb-0.5">Soft Stop</p>
              <p className="text-amber-400 font-semibold">-${APEX_PRESETS[accountType].softStop}</p>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-gray-500 mb-0.5">Default Risk</p>
              <p className="text-white font-semibold">${APEX_PRESETS[accountType].defaultRisk}/trade</p>
            </div>
          </div>
        )}

        {/* Post-loss day toggle */}
        <div className="border-t border-gray-700/50 pt-4">
          <div className="flex items-center justify-between mb-1">
            <div>
              <p className="text-sm font-medium text-gray-200">Post-Loss Day</p>
              <p className="text-xs text-gray-500 mt-0.5">Trade half base size for the entire session</p>
            </div>
            <button
              onClick={handlePostLossToggle}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                postLossDay ? 'bg-amber-500' : 'bg-gray-700'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  postLossDay ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </button>
          </div>
          {postLossDay && (
            <p className="text-xs text-amber-400 mt-2">
              Active — half base size today. Dashboard banner is showing.
            </p>
          )}
        </div>
      </section>

      {/* Risk Rules */}
      <section className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">Risk Rules</h2>
        {accountType && (
          <p className="text-xs text-gray-500 mb-4">Auto-populated from {accountType} preset. Adjust as needed.</p>
        )}
        {!accountType && <div className="mb-5" />}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Max Daily Loss ($)</label>
            <input
              type="number"
              value={maxDailyLoss}
              onChange={(e) => setMaxDailyLoss(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Stop trading when loss hits this amount</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Max Consecutive Losses</label>
            <input
              type="number"
              value={maxConsecutiveLosses}
              onChange={(e) => setMaxConsecutiveLosses(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Stop after this many losses in a row</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Default Risk Per Trade ($)</label>
            <input
              type="number"
              value={defaultRisk}
              onChange={(e) => setDefaultRisk(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Your standard risk amount per trade</p>
          </div>
        </div>
        <button
          onClick={handleSaveRiskRules}
          disabled={savingRisk}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
        >
          {savingRisk ? 'Saving...' : 'Save Risk Rules'}
        </button>
      </section>

      {/* Pre-session Checklist */}
      <section className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-white">Pre-Session Checklist</h2>
          <button
            onClick={handleResetChecklist}
            disabled={resetingChecklist}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg transition disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            {resetingChecklist ? 'Resetting…' : 'Reset to System Defaults'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-4">Items to verify before trading each day</p>

        <div className="space-y-2 mb-4">
          {checklistItems.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No checklist items yet</p>
          ) : (
            checklistItems.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5"
              >
                <GripVertical className="h-4 w-4 text-gray-600 flex-shrink-0" />
                <span className="flex-1 text-sm text-gray-300">{item.label}</span>
                <span className="text-xs text-gray-600">{index + 1}</span>
                <button
                  onClick={() => handleDeleteChecklistItem(item.id)}
                  className="p-1 rounded text-gray-600 hover:text-red-400 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newChecklistLabel}
            onChange={(e) => setNewChecklistLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddChecklistItem()}
            placeholder="Add checklist item..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAddChecklistItem}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </section>

      {/* Notifications */}
      <section className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-2">Session Close Reminder</h2>
        <p className="text-sm text-gray-400 mb-4">
          Receive a browser notification at <span className="text-white font-medium">3:15 PM CT</span> when the CME ES futures regular session closes. The app must be open in a tab.
        </p>
        {notifPermission === 'denied' && (
          <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
            Notifications are blocked by your browser. Open browser settings and allow notifications for this site.
          </div>
        )}
        <button
          onClick={handleNotifToggle}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition',
            notifEnabled
              ? 'bg-emerald-600/20 border border-emerald-600/40 text-emerald-400 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-400'
              : 'bg-blue-600 hover:bg-blue-500 text-white'
          )}
        >
          {notifEnabled ? (
            <><BellOff className="h-4 w-4" /> Disable Reminder</>
          ) : (
            <><Bell className="h-4 w-4" /> Enable 3:15 PM Reminder</>
          )}
        </button>
      </section>

      {/* Export */}
      <section className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-2">Export Journal</h2>
        <p className="text-sm text-gray-400 mb-4">Download all your trades as a CSV file for analysis in Excel or Google Sheets.</p>
        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition"
        >
          <Download className="h-4 w-4" />
          Export to CSV
        </button>
        <p className="text-xs text-gray-500 mt-2">{allTrades.length} trades will be exported</p>
      </section>

      {/* Search */}
      <section className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-2">Search Journal</h2>
        <p className="text-sm text-gray-400 mb-4">Search across all trade notes, reflections, setup tags, and custom tags.</p>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes, reflections, tags..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {searchQuery && (
          <div className="space-y-2">
            {searchResults.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No matching trades found</p>
            ) : (
              searchResults.map((trade) => (
                <div key={trade.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'text-xs font-semibold px-1.5 py-0.5 rounded',
                        trade.direction === 'long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      )}>
                        {trade.direction.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-400">{format(parseISO(trade.date), 'MMM d, yyyy')}</span>
                      {trade.setup_tag && (
                        <span className="text-xs text-blue-400">{trade.setup_tag}</span>
                      )}
                    </div>
                    <span className={cn('text-xs font-semibold', trade.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      ${trade.net_pnl.toFixed(2)}
                    </span>
                  </div>
                  {trade.notes && (
                    <p className="text-xs text-gray-400 line-clamp-1">{trade.notes}</p>
                  )}
                  {trade.reflection && (
                    <p className="text-xs text-gray-500 line-clamp-1 mt-0.5 italic">{trade.reflection}</p>
                  )}
                  {trade.tags && trade.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {trade.tags.map((tag) => (
                        <span key={tag} className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
            {searchResults.length > 0 && allTrades.filter((t) => {
              const q = searchQuery.toLowerCase()
              return (t.notes || '').toLowerCase().includes(q) ||
                (t.reflection || '').toLowerCase().includes(q) ||
                (t.tags || []).join(' ').toLowerCase().includes(q) ||
                (t.setup_tag || '').toLowerCase().includes(q)
            }).length > 10 && (
              <p className="text-xs text-gray-500 text-center">
                Showing top 10 results
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
