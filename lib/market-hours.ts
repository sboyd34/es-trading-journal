import { chicagoHour, chicagoToday, weekdayOf } from '@/lib/ct-week'

/**
 * Returns true when CME equity-index futures (ES/MES) are in their Globex session.
 * Globex runs Sunday 17:00 CT → Friday 16:00 CT, with a daily maintenance halt
 * 16:00–17:00 CT. Widened from the old RTH-only (08:00–16:00) check so overnight
 * Asia/London fills get auto-synced instead of waiting for the next morning.
 *
 * Called from both sides of the wire — the Tradovate cron (server, TZ=UTC) and
 * the dashboard sync badge (browser, viewer's TZ) — so it has to read CT
 * directly rather than inferring it from the host clock.
 *
 * This used to format the instant into a CT wall-clock string and re-parse it
 * so the local getters would report CT values. That works on V8 but relies on
 * Date parsing a locale string no spec requires it to accept, and it fails
 * silently: an unparseable string yields Invalid Date, every comparison below
 * goes false, and the sync just quietly stops pulling fills.
 */
export function isMarketHours(): boolean {
  const day = weekdayOf(chicagoToday()) // 0 Sun … 6 Sat
  const h = chicagoHour()
  if (day === 6) return false       // Saturday: closed all day
  if (day === 0) return h >= 17     // Sunday: opens 17:00 CT
  if (day === 5) return h < 16      // Friday: closes 16:00 CT
  return h !== 16                   // Mon–Thu: open except the 16:00–17:00 halt
}
