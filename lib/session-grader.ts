import { Trade, DailySession, DisciplineBreakdown } from '@/types'

export interface DisciplineScore {
  score: number
  breakdown: DisciplineBreakdown
}

const EMOTIONAL_MOODS = new Set(['FOMO', 'fomo', 'revenge', 'anxious', 'overconfident'])

export function computeDisciplineScore(
  trades: Trade[],
  session: DailySession | null,
): DisciplineScore {
  const total = trades.length

  // 1. Setup compliance (25 pts) — F-grade = off-system discipline lapse
  const nonF = trades.filter((t) => t.grade !== 'F').length
  const setup = total === 0 ? 25 : Math.round((nonF / total) * 25)

  // 2. Emotional discipline (25 pts) — FOMO/revenge/anxious/overconfident = penalty
  const emotional = trades.filter((t) => t.mood !== null && EMOTIONAL_MOODS.has(t.mood)).length
  const emotion = total === 0 ? 25 : Math.round(((total - emotional) / total) * 25)

  // 3. Pre-market prep (25 pts) — checklist must be explicitly passed
  const prep = session?.checklist_passed === true ? 25 : 0

  // 4. Trade grade quality (25 pts) — A/B out of all graded trades
  const graded = trades.filter((t) => t.grade !== null)
  const ab = graded.filter((t) => t.grade === 'A' || t.grade === 'B').length
  const grade = graded.length === 0 ? 25 : Math.round((ab / graded.length) * 25)

  return {
    score: setup + emotion + prep + grade,
    breakdown: { setup, emotion, prep, grade },
  }
}
