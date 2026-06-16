/**
 * Returns true when CME equity-index futures (ES/MES) are in their Globex session.
 * Globex runs Sunday 17:00 CT → Friday 16:00 CT, with a daily maintenance halt
 * 16:00–17:00 CT. Widened from the old RTH-only (08:00–16:00) check so overnight
 * Asia/London fills get auto-synced instead of waiting for the next morning.
 */
export function isMarketHours(): boolean {
  const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const day = ct.getDay() // 0 Sun … 6 Sat
  const h = ct.getHours()
  if (day === 6) return false       // Saturday: closed all day
  if (day === 0) return h >= 17     // Sunday: opens 17:00 CT
  if (day === 5) return h < 16      // Friday: closes 16:00 CT
  return h !== 16                   // Mon–Thu: open except the 16:00–17:00 halt
}
