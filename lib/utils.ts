import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

export function getPnLColor(value: number): string {
  if (value > 0) return 'text-emerald-400'
  if (value < 0) return 'text-red-400'
  return 'text-gray-400'
}

export function getMoodEmoji(mood: string | null): string {
  const map: Record<string, string> = {
    calm: '😌',
    confident: '💪',
    anxious: '😰',
    FOMO: '🤑',
    revenge: '😤',
    hesitant: '😟',
    bored: '😴',
    overconfident: '🦅',
  }
  return mood ? (map[mood] || '❓') : '—'
}

export function getGradeColor(grade: string | null): string {
  if (grade === 'A') return 'text-emerald-400 bg-emerald-400/10'
  if (grade === 'B') return 'text-yellow-400 bg-yellow-400/10'
  if (grade === 'C') return 'text-red-400 bg-red-400/10'
  return 'text-gray-400 bg-gray-400/10'
}
