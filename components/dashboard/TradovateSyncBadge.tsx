'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { isMarketHours } from '@/lib/market-hours'

interface SyncStatus {
  connected: boolean
  username?: string
  lastSync: string | null
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function TradovateSyncBadge() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const router = useRouter()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/tradovate/status')
      const data = await res.json()
      setStatus(data)
      return data.connected as boolean
    } catch {
      return false
    }
  }, [])

  const doSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await fetch('/api/tradovate/sync', { method: 'POST' })
      const data = await res.json()
      if (data.inserted > 0) router.refresh()
      await fetchStatus()
    } catch {
      // silent — badge stays visible; no toast here
    } finally {
      setSyncing(false)
    }
  }, [syncing, fetchStatus, router])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Auto-sync every 60 s during market hours when connected
  useEffect(() => {
    if (!status?.connected) return
    intervalRef.current = setInterval(() => {
      if (isMarketHours()) doSync()
    }, 60_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [status?.connected, doSync])

  if (!status) return null

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <span
        className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
          status.connected ? 'bg-emerald-500' : 'bg-gray-600'
        }`}
      />
      <span className={status.connected ? 'text-gray-400' : 'text-gray-600'}>
        {status.connected ? 'Tradovate' : 'Tradovate disconnected'}
      </span>
      {status.connected && (
        <span className="text-gray-600">
          ·{' '}
          {syncing
            ? 'syncing…'
            : status.lastSync
              ? relativeTime(status.lastSync)
              : 'never synced'}
        </span>
      )}
    </div>
  )
}
