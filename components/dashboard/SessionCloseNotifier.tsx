'use client'

import { useEffect, useRef } from 'react'

const STORAGE_KEY = 'sessionCloseNotification'

function getCTHourMinute(): { hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(new Date())
  return {
    hour: parseInt(parts.find((p) => p.type === 'hour')!.value),
    minute: parseInt(parts.find((p) => p.type === 'minute')!.value),
    second: parseInt(parts.find((p) => p.type === 'second')!.value),
  }
}

export default function SessionCloseNotifier() {
  const firedRef = useRef<string | null>(null)

  useEffect(() => {
    const check = () => {
      const enabled = localStorage.getItem(STORAGE_KEY) === 'true'
      if (!enabled || Notification.permission !== 'granted') return

      const { hour, minute, second } = getCTHourMinute()
      const todayKey = new Date().toDateString()

      if (hour === 15 && minute === 15 && second < 30 && firedRef.current !== todayKey) {
        firedRef.current = todayKey
        new Notification('ES Session Closing — 3:15 PM CT', {
          body: 'CME ES futures regular session is ending. Close your positions and update your trade journal.',
          tag: 'session-close',
          requireInteraction: false,
        })
      }
    }

    check()
    const id = setInterval(check, 10_000)
    return () => clearInterval(id)
  }, [])

  return null
}

export { STORAGE_KEY }
