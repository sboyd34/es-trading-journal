'use client'

import Link from 'next/link'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EodGateCardProps {
  /** Optional label shown above the lock — defaults to "Today's P&L" so the
   *  card looks like the StatCard slot it's replacing. */
  label?: string
  className?: string
}

/**
 * Replaces a P&L surface (e.g., the dashboard's Today's P&L StatCard) with a
 * locked CTA that deeplinks the user to the EOD review tab.
 *
 * Spec: docs/superpowers/specs/2026-05-25-eod-review-gate-design.md
 */
export function EodGateCard({ label = "Today's P&L", className }: EodGateCardProps) {
  return (
    <Link
      href="/journal?tab=eod"
      className={cn(
        'rounded-lg border border-gray-700 bg-gray-800/40 p-4',
        'hover:bg-gray-800/70 hover:border-gray-600 transition group',
        'flex flex-col justify-between min-h-[96px]',
        className,
      )}
    >
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
        {label}
      </p>
      <div className="flex items-center gap-2 mt-2">
        <Lock className="h-5 w-5 text-amber-400" />
        <span className="text-lg font-semibold text-amber-300 group-hover:text-amber-200">
          Complete EOD Review
        </span>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        Process before P&amp;L →
      </p>
    </Link>
  )
}
