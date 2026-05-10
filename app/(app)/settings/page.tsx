'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RiskRules, ChecklistItem, Trade } from '@/types'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { Plus, Trash2, GripVertical, Download, Search } from 'lucide-react'
import { format, parseISO } from 'date-fns'

export default function SettingsPage() {
  const [riskRules, setRiskRules] = useState<RiskRules | null>(null)
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const [allTrades, setAllTrades] = useState<Trade[]>([])
  const [savingRisk, setSavingRisk] = useState(false)
  const [newChecklistLabel, setNewChecklistLabel] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Trade[]>([])

  // Risk form state
  const [maxDailyLoss, setMaxDailyLoss] = useState('500')
  const [maxTrades, setMaxTrades] = useState('6')
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
      setMaxTrades(rr.max_trades.toString())
      setMaxConsecutiveLosses(rr.max_consecutive_losses.toString())
      setDefaultRisk(rr.default_risk.toString())
    }

    setChecklistItems((cl as ChecklistItem[]) || [])
    setAllTrades((trades as Trade[]) || [])
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  async function handleSaveRiskRules() {
    setSavingRisk(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const updates = {
        max_daily_loss: parseFloat(maxDailyLoss) || 500,
        max_trades: parseInt(maxTrades) || 6,
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

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">Configure your journal preferences</p>
      </div>

      {/* Risk Rules */}
      <section className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-5">Risk Rules</h2>
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
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Max Trades Per Day</label>
            <input
              type="number"
              value={maxTrades}
              onChange={(e) => setMaxTrades(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Maximum number of trades in a day</p>
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
        <h2 className="text-base font-semibold text-white mb-5">Pre-Session Checklist</h2>
        <p className="text-xs text-gray-500 mb-4">Items you must complete before trading each day</p>

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
                      ${trade.net_pnl.toFixed(0)}
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
