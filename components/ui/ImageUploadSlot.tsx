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

  return (
    <div>
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
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={`w-full ${heightClass} border-2 border-dashed border-gray-700 hover:border-gray-500 rounded-lg flex flex-col items-center justify-center gap-1.5 text-gray-500 hover:text-gray-300 transition disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {uploading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-xs">Uploading…</span>
            </>
          ) : (
            <>
              <Camera className="h-5 w-5" />
              <span className="text-xs">Upload chart</span>
              <span className="text-[10px] text-gray-600">or camera roll on mobile</span>
            </>
          )}
        </button>
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
