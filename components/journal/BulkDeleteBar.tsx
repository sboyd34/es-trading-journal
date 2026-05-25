'use client'

import { Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BulkDeleteBarProps {
  count: number
  busy?: boolean
  onDelete: () => void
  onCancel: () => void
}

export function BulkDeleteBar({ count, busy = false, onDelete, onCancel }: BulkDeleteBarProps) {
  if (count === 0) return null

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
    >
      <div className="flex items-center gap-3 rounded-full border border-gray-700 bg-gray-900/95 px-4 py-2.5 shadow-xl backdrop-blur">
        <span className="text-sm text-gray-200 font-medium pl-1">
          {count} selected
        </span>

        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition',
            'bg-red-500/10 text-red-300 border border-red-500/40',
            'hover:bg-red-500/20 hover:text-red-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {busy ? 'Deleting…' : `Delete ${count} trade${count === 1 ? '' : 's'}`}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Clear selection"
          className="rounded-full p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
