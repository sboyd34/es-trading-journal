/**
 * One definition of "which CT week is it".
 *
 * The weekly review page and the market-brief panel both have to answer this,
 * and they have to answer it the SAME way: the panel decides whether to fall
 * forward to the upcoming week by comparing the page's selected week against
 * the current one, so any disagreement silently disables the fall-forward.
 * They each carried a private copy of the math, which is exactly how they
 * drifted apart.
 *
 * Anchored to America/Chicago, never the viewer's clock. The Sunday brief job
 * runs at 08:00 CT and files under a CT week, and trades are stamped with CT
 * dates — so a viewer in Eastern or Pacific has to get the same answer as the
 * machine that wrote the data. Reading local time put the page a full week off
 * in the hours where the local date and the CT date disagree, which defaulted
 * the whole review onto a week with no trades in it.
 */
const CT = 'America/Chicago'

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Shift a YYYY-MM-DD string by n days. UTC math — local time never enters. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
  next.setUTCDate(next.getUTCDate() + n)
  return isoDate(next)
}

/** Today's calendar date in CT. en-CA renders YYYY-MM-DD, already the wire format. */
export function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Current hour in CT, 0-23.
 *
 * hourCycle 'h23' rather than hour12:false — the latter reports midnight as
 * hour 24 in some engines, which would read as "past the cutoff" at exactly
 * the wrong moment.
 */
export function chicagoHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: CT,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()),
  )
}

/** Weekday of a calendar date, read via UTC so it never re-enters local time. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay()
}

/** Monday of the CT week containing today. */
export function currentMonday(): string {
  const today = chicagoToday()
  const day = weekdayOf(today)
  return addDays(today, day === 0 ? -6 : 1 - day)
}
