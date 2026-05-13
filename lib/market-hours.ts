/** Returns true if current time is 8:00 AM – 4:00 PM CT, Monday–Friday */
export function isMarketHours(): boolean {
  const ct = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const day = ct.getDay()
  const h = ct.getHours()
  return day >= 1 && day <= 5 && h >= 8 && h < 16
}
