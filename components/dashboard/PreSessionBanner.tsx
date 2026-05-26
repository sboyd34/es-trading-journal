'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import type { DailySession } from '@/types'
import { isRitualPending } from '@/lib/preopen-ritual'

interface PreSessionBannerProps {
  session: DailySession | null
}

/**
 * Silent-when-clean banner that prompts the user to complete the daily
 * Pre-Session Ritual. Renders nothing on weekends OR when the ritual is
 * already saved for today.
 *
 * Spec: docs/superpowers/specs/2026-05-26-preopen-ritual-design.md
 */
export default function PreSessionBanner({ session }: PreSessionBannerProps) {
  if (!isRitualPending(new Date(), session)) return null

  return (
    <Link
      href="/pre-market"
      className="block rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 transition px-4 py-3"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-200">
            Pre-session ritual pending
          </p>
          <p className="text-xs text-amber-300/70 mt-0.5">
            Read the 15 rules and complete the Pre-Open Check before you trade →
          </p>
        </div>
        <span className="text-amber-300 text-sm font-medium hidden sm:inline">
          Open ritual
        </span>
      </div>
    </Link>
  )
}
