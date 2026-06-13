'use client'

import { useRef } from 'react'
import { Camera, Loader2, X, ExternalLink } from 'lucide-react'

interface Props {
  label: string
  currentUrl: string | null
  uploading: boolean
  onFile: (file: File) => void
  onClear: () => void
  heightClass?: string
}

export default function ImageUploadSlot({
  label,
  currentUrl,
  uploading,
  onFile,
  onClear,
  heightClass = 'h-28',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    const file = item?.getAsFile()
    if (file) {
      e.preventDefault()
      onFile(file)
    }
  }

  return (
    <div
      tabIndex={0}
      onPaste={handlePaste}
      className="rounded-lg outline-none focus:ring-2 focus:ring-blue-500/50 focus-within:ring-2 focus-within:ring-blue-500/50"
    >
      {label && <p className="text-xs font-medium text-gray-400 mb-1.5">{label}</p>}
      {currentUrl ? (
        <div className="relative group rounded-lg overflow-hidden border border-gray-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentUrl} alt={label} className={`w-full ${heightClass} object-cover`} />
          <div className="absolute inset-0 bg-gray-900/0 group-hover:bg-gray-900/40 transition flex items-start justify-end gap-1 p-1">
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded-full bg-gray-900/80 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition"
              title="Open full size"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={onClear}
              className="p-1 rounded-full bg-gray-900/80 text-gray-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
              title="Remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`w-full ${heightClass} border-2 border-dashed border-gray-700 hover:border-gray-500 rounded-lg flex flex-col items-center justify-center gap-1 text-gray-500 transition ${uploading ? 'opacity-50' : ''}`}
        >
          {uploading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Uploading…</span>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex flex-col items-center gap-1 px-4 py-1.5 rounded text-gray-500 hover:text-gray-300 transition"
              >
                <Camera className="h-5 w-5" />
                <span className="text-xs">Upload chart</span>
              </button>
              <span className="text-[10px] text-gray-600">or click here + ⌘V to paste · camera roll on mobile</span>
            </>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
