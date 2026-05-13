'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'

function msUntilNextTrigger(): number {
  // 3:15 PM Central Time daily
  // CT = UTC-6 (CST) or UTC-5 (CDT); we use UTC-5 (CDT) for trading season
  // 3:15 PM CT = 20:15 UTC (CDT) or 21:15 UTC (CST)
  const now = new Date()
  const todayCT = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))

  const target = new Date(todayCT)
  target.setHours(15, 15, 0, 0)

  let diffMs = target.getTime() - todayCT.getTime()
  if (diffMs <= 0) {
    // Already past 3:15 today — schedule for tomorrow
    diffMs += 24 * 60 * 60 * 1000
  }
  return diffMs
}

export default function DailySummaryReminder() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  )
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleReminder() {
    if (timerRef.current) clearTimeout(timerRef.current)
    const delay = msUntilNextTrigger()
    timerRef.current = setTimeout(() => {
      if (Notification.permission === 'granted') {
        new Notification('ES Journal — Daily Summary', {
          body: 'Market closed. Time to generate your end-of-day summary.',
          icon: '/favicon.ico',
          tag: 'daily-summary',
        })
      }
      // Schedule for next day
      scheduleReminder()
    }, delay)
  }

  async function requestPermission() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') scheduleReminder()
  }

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    setPermission(Notification.permission)
    if (Notification.permission === 'granted') scheduleReminder()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (permission === 'granted') {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Bell className="h-3.5 w-3.5 text-emerald-500" />
        <span>3:15 CT reminder enabled</span>
      </div>
    )
  }

  if (permission === 'denied') {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <BellOff className="h-3.5 w-3.5 text-red-400" />
        <span>Notifications blocked — enable in browser settings</span>
      </div>
    )
  }

  return (
    <button
      onClick={requestPermission}
      className="flex items-center gap-2 text-xs text-gray-400 hover:text-white border border-gray-700/50 hover:border-gray-600 rounded-lg px-3 py-1.5 transition"
    >
      <Bell className="h-3.5 w-3.5" />
      Enable 3:15 CT daily summary reminder
    </button>
  )
}
