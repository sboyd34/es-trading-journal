'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Trade, PlaybookSetup } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import toast from 'react-hot-toast'
import { Plus, Tag, BarChart2, ChevronRight, X, Download } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { PLAYBOOK_SETUPS } from '@/lib/trading-system'

interface SetupWithStats extends PlaybookSetup {
  tradeCount: number
  winRate: number
  avgPnL: number
  totalPnL: number
}

export default function PlaybookPage() {
  const [setups, setSetups] = useState<PlaybookSetup[]>([])
  const [trades, setTrades] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [selectedSetup, setSelectedSetup] = useState<SetupWithStats | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [entryCriteria, setEntryCriteria] = useState('')
  const [exitCriteria, setExitCriteria] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadingSystem, setLoadingSystem] = useState(false)

  const supabase = createClient()

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: setupData }, { data: tradeData }] = await Promise.all([
      supabase.from('playbook_setups').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('trades').select('*').eq('user_id', user.id),
    ])

    setSetups((setupData as PlaybookSetup[]) || [])
    setTrades((tradeData as Trade[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  const setupsWithStats = useMemo<SetupWithStats[]>(() => {
    return setups.map((setup) => {
      const setupTrades = trades.filter((t) => t.setup_tag === setup.name)
      const winners = setupTrades.filter((t) => t.net_pnl > 0)
      const totalPnL = setupTrades.reduce((s, t) => s + t.net_pnl, 0)
      return {
        ...setup,
        tradeCount: setupTrades.length,
        winRate: setupTrades.length ? (winners.length / setupTrades.length) * 100 : 0,
        avgPnL: setupTrades.length ? totalPnL / setupTrades.length : 0,
        totalPnL,
      }
    })
  }, [setups, trades])

  function resetForm() {
    setName('')
    setDescription('')
    setEntryCriteria('')
    setExitCriteria('')
    setTags('')
  }

  async function handleAddSetup() {
    if (!name.trim()) {
      toast.error('Setup name is required')
      return
    }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('playbook_setups')
        .insert({
          user_id: user.id,
          name: name.trim(),
          description: description.trim(),
          entry_criteria: entryCriteria.trim(),
          exit_criteria: exitCriteria.trim(),
          tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        })
        .select()
        .single()

      if (error) throw error
      setSetups((prev) => [data as PlaybookSetup, ...prev])
      toast.success('Setup added!')
      setAddModalOpen(false)
      resetForm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleLoadSystemSetups() {
    setLoadingSystem(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const existingNames = new Set(setups.map((s) => s.name))
      const toInsert = PLAYBOOK_SETUPS.filter((s) => !existingNames.has(s.name)).map((s) => ({
        user_id: user.id,
        ...s,
      }))

      if (toInsert.length === 0) {
        toast('All system setups already loaded', { icon: 'ℹ️' })
        return
      }

      const { data, error } = await supabase.from('playbook_setups').insert(toInsert).select()
      if (error) throw error
      setSetups((prev) => [...(data as PlaybookSetup[]), ...prev])
      toast.success(`Loaded ${toInsert.length} system setup${toInsert.length !== 1 ? 's' : ''}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load setups')
    } finally {
      setLoadingSystem(false)
    }
  }

  async function handleDeleteSetup(id: string) {
    if (!confirm('Delete this setup?')) return
    const { error } = await supabase.from('playbook_setups').delete().eq('id', id)
    if (error) {
      toast.error(error.message)
      return
    }
    setSetups((prev) => prev.filter((s) => s.id !== id))
    if (selectedSetup?.id === id) setSelectedSetup(null)
    toast.success('Setup deleted')
  }

  const selectedTrades = useMemo(() => {
    if (!selectedSetup) return []
    return trades
      .filter((t) => t.setup_tag === selectedSetup.name)
      .sort((a, b) => new Date(b.entry_time).getTime() - new Date(a.entry_time).getTime())
  }, [selectedSetup, trades])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Playbook</h1>
          <p className="text-sm text-gray-400 mt-1">{setups.length} setups defined</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleLoadSystemSetups}
            disabled={loadingSystem}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
          >
            <Download className="h-4 w-4" />
            {loadingSystem ? 'Loading…' : 'Load System Setups'}
          </button>
          <button
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition"
          >
            <Plus className="h-4 w-4" />
            Add Setup
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading playbook...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Setup list */}
          <div className="space-y-3">
            {setupsWithStats.length === 0 ? (
              <div className="text-center py-12 bg-gray-800/30 border border-gray-700/50 rounded-xl">
                <Tag className="h-8 w-8 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 font-medium">No setups yet</p>
                <p className="text-gray-600 text-sm mt-1">Create your first setup to track your edge</p>
              </div>
            ) : (
              setupsWithStats.map((setup) => (
                <div
                  key={setup.id}
                  onClick={() => setSelectedSetup(setup)}
                  className={cn(
                    'bg-gray-800/50 border rounded-xl p-4 cursor-pointer transition hover:border-gray-600',
                    selectedSetup?.id === setup.id
                      ? 'border-blue-500/50 bg-blue-500/5'
                      : 'border-gray-700/50'
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-white text-sm">{setup.name}</h3>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSetup(setup.id) }}
                        className="p-1 rounded text-gray-600 hover:text-red-400 transition"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <ChevronRight className="h-4 w-4 text-gray-600" />
                    </div>
                  </div>
                  {setup.description && (
                    <p className="text-xs text-gray-500 mb-3 line-clamp-2">{setup.description}</p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-gray-500">Trades</p>
                      <p className="text-sm font-semibold text-white">{setup.tradeCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500">Win Rate</p>
                      <p className={cn('text-sm font-semibold', setup.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400')}>
                        {setup.tradeCount ? `${setup.winRate.toFixed(0)}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500">Avg P&L</p>
                      <p className={cn('text-sm font-semibold', setup.avgPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {setup.tradeCount ? formatCurrency(setup.avgPnL) : '—'}
                      </p>
                    </div>
                  </div>
                  {setup.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {setup.tags.map((tag) => (
                        <span key={tag} className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Setup detail */}
          <div className="lg:col-span-2">
            {selectedSetup ? (
              <div className="space-y-4">
                {/* Setup info */}
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-white">{selectedSetup.name}</h2>
                    <div className="flex gap-3 text-sm">
                      <span className={cn('font-semibold', selectedSetup.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {formatCurrency(selectedSetup.totalPnL)} total
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-400">Trades</p>
                      <p className="text-xl font-bold text-white">{selectedSetup.tradeCount}</p>
                    </div>
                    <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-400">Win Rate</p>
                      <p className={cn('text-xl font-bold', selectedSetup.winRate >= 50 ? 'text-emerald-400' : 'text-yellow-400')}>
                        {selectedSetup.tradeCount ? `${selectedSetup.winRate.toFixed(1)}%` : '—'}
                      </p>
                    </div>
                    <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-400">Avg P&L</p>
                      <p className={cn('text-xl font-bold', selectedSetup.avgPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {selectedSetup.tradeCount ? formatCurrency(selectedSetup.avgPnL) : '—'}
                      </p>
                    </div>
                  </div>

                  {selectedSetup.description && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-400 font-medium mb-1">Description</p>
                      <p className="text-sm text-gray-300">{selectedSetup.description}</p>
                    </div>
                  )}

                  {selectedSetup.entry_criteria && (
                    <div className="mb-3">
                      <p className="text-xs text-emerald-400 font-medium mb-1">Entry Criteria</p>
                      <p className="text-sm text-gray-300 whitespace-pre-line">{selectedSetup.entry_criteria}</p>
                    </div>
                  )}

                  {selectedSetup.exit_criteria && (
                    <div>
                      <p className="text-xs text-red-400 font-medium mb-1">Exit Criteria</p>
                      <p className="text-sm text-gray-300 whitespace-pre-line">{selectedSetup.exit_criteria}</p>
                    </div>
                  )}
                </div>

                {/* Trades using this setup */}
                <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-700/50">
                    <h3 className="text-sm font-semibold text-gray-200">Trades Using This Setup</h3>
                  </div>
                  {selectedTrades.length === 0 ? (
                    <div className="px-5 py-8 text-center text-gray-500 text-sm">
                      No trades tagged with &quot;{selectedSetup.name}&quot; yet
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-700/50">
                            <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Date</th>
                            <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Dir</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Entry</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">Exit</th>
                            <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500">P&L</th>
                            <th className="text-center px-4 py-2.5 text-xs font-medium text-gray-500">Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTrades.slice(0, 20).map((trade) => (
                            <tr key={trade.id} className="border-b border-gray-700/30 hover:bg-gray-700/20">
                              <td className="px-4 py-2.5 text-gray-300 text-xs">{format(parseISO(trade.date), 'MM/dd/yy')}</td>
                              <td className="px-4 py-2.5">
                                <span className={cn('text-xs font-semibold', trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400')}>
                                  {trade.direction === 'long' ? 'L' : 'S'}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-300 font-mono text-xs">{trade.entry_price.toFixed(2)}</td>
                              <td className="px-4 py-2.5 text-right text-gray-300 font-mono text-xs">{trade.exit_price.toFixed(2)}</td>
                              <td className={cn('px-4 py-2.5 text-right font-semibold text-xs', trade.net_pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                                {formatCurrency(trade.net_pnl)}
                              </td>
                              <td className="px-4 py-2.5 text-center text-xs text-gray-400">{trade.grade || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 bg-gray-800/30 border border-gray-700/50 rounded-xl text-center">
                <BarChart2 className="h-10 w-10 text-gray-600 mb-3" />
                <p className="text-gray-400 font-medium">Select a setup to view details</p>
                <p className="text-gray-600 text-sm mt-1">Or add a new setup with the button above</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Setup Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => { setAddModalOpen(false); resetForm() }}
        title="Add Playbook Setup"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Setup Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Breakout Retest, Opening Drive, VWAP Fade"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Brief overview of this setup..."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-emerald-400 mb-1.5">Entry Criteria</label>
            <textarea
              value={entryCriteria}
              onChange={(e) => setEntryCriteria(e.target.value)}
              rows={3}
              placeholder="What conditions must be met to enter this trade?"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-red-400 mb-1.5">Exit Criteria</label>
            <textarea
              value={exitCriteria}
              onChange={(e) => setExitCriteria(e.target.value)}
              rows={3}
              placeholder="When do you exit? (target, stop, time-based?)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. momentum, trend-following, reversal (comma separated)"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setAddModalOpen(false); resetForm() }}
              className="flex-1 py-2.5 rounded-lg border border-gray-700 text-sm font-medium text-gray-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAddSetup}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-semibold text-white transition"
            >
              {saving ? 'Saving...' : 'Add Setup'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
