// Client-side driver for the excursion enrichment route. The route processes a
// bounded batch per call (to dodge serverless timeouts); this loops it until the
// server reports 0 remaining. Shared by post-import enrichment and Settings backfill.

export interface EnrichBatchResult {
  processed: number
  complete: number
  no_data: number
  failed: number
  remaining: number
}

export interface EnrichProgress {
  complete: number
  no_data: number
  failed: number
  remaining: number
}

interface RunOpts {
  batchSize?: number
  maxBatches?: number
  onProgress?: (p: EnrichProgress) => void
}

/**
 * Drains the pending excursion queue by POSTing batches until none remain.
 * Returns cumulative totals. Best-effort: a network error stops the loop and
 * returns what was done so far rather than throwing (enrichment must never be
 * fatal to the caller — imports still succeed).
 */
export async function runExcursionEnrichment(opts: RunOpts = {}): Promise<EnrichProgress> {
  const { batchSize = 40, maxBatches = 100, onProgress } = opts

  const totals: EnrichProgress = { complete: 0, no_data: 0, failed: 0, remaining: 0 }

  for (let batch = 0; batch < maxBatches; batch++) {
    let res: Response
    try {
      res = await fetch('/api/trades/enrich-excursions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: batchSize }),
      })
    } catch {
      break
    }

    if (!res.ok) break

    const data = (await res.json()) as EnrichBatchResult
    totals.complete += data.complete
    totals.no_data += data.no_data
    totals.failed += data.failed
    totals.remaining = data.remaining

    onProgress?.({ ...totals })

    // Nothing processed this round (all-failed batch or empty) — stop to avoid a spin loop.
    if (data.processed === 0 || data.remaining === 0) break
  }

  return totals
}
