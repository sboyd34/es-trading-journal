import Papa from 'papaparse'

export interface TradovateCsvRow {
  account: string
  contract: string
  side: string
  qty: number
  price: number
  orderId: string
  dateTime: string
}

export interface ParsedTrade {
  date: string
  entry_time: string
  exit_time: string
  direction: 'long' | 'short'
  quantity: number
  entry_price: number
  exit_price: number
  gross_pnl: number
  commission: number
  net_pnl: number
  tradovate_order_id: string
}

interface RawCsvRow {
  Account?: string
  account?: string
  Contract?: string
  contract?: string
  Side?: string
  side?: string
  Qty?: string
  qty?: string
  Price?: string
  price?: string
  OrderId?: string
  orderId?: string
  'Order Id'?: string
  DateTime?: string
  dateTime?: string
  'Date/Time'?: string
  [key: string]: string | undefined
}

function parseDateTime(dtStr: string): Date {
  // Handle MM/DD/YYYY HH:MM:SS format
  const parts = dtStr.trim().split(' ')
  if (parts.length < 2) {
    return new Date(dtStr)
  }
  const [datePart, timePart] = parts
  const [month, day, year] = datePart.split('/')
  return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timePart}`)
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

export function parseTradovateCSV(csvText: string): ParsedTrade[] {
  const result = Papa.parse<RawCsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  })

  if (result.errors.length > 0) {
    console.warn('CSV parse warnings:', result.errors)
  }

  // Normalize rows
  const rows: TradovateCsvRow[] = result.data
    .filter((row) => {
      const contract = row.Contract || row.contract || ''
      const side = row.Side || row.side || ''
      const qty = row.Qty || row.qty || ''
      const price = row.Price || row.price || ''
      return contract && side && qty && price
    })
    .map((row) => {
      const dateTimeRaw =
        row.DateTime || row.dateTime || row['Date/Time'] || ''
      const orderIdRaw =
        row.OrderId || row.orderId || row['Order Id'] || ''
      return {
        account: row.Account || row.account || '',
        contract: (row.Contract || row.contract || '').trim(),
        side: (row.Side || row.side || '').trim(),
        qty: parseFloat(row.Qty || row.qty || '0'),
        price: parseFloat(row.Price || row.price || '0'),
        orderId: orderIdRaw.trim(),
        dateTime: dateTimeRaw.trim(),
      }
    })
    .filter((row) => !isNaN(row.qty) && !isNaN(row.price) && row.qty > 0)

  // Group rows by contract+date (trading day)
  const groups = new Map<string, TradovateCsvRow[]>()
  for (const row of rows) {
    const dt = parseDateTime(row.dateTime)
    const dateKey = formatDate(dt)
    const key = `${row.contract}_${dateKey}`
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(row)
  }

  const parsedTrades: ParsedTrade[] = []

  for (const key of Array.from(groups.keys())) {
    const groupRows = groups.get(key)!
    // Sort by dateTime ascending
    groupRows.sort((a: TradovateCsvRow, b: TradovateCsvRow) => {
      const da = parseDateTime(a.dateTime)
      const db = parseDateTime(b.dateTime)
      return da.getTime() - db.getTime()
    })

    // FIFO matching: maintain a queue of open positions
    // Each open position: { side: 'long'|'short', qty: number, price: number, time: Date, orderId: string }
    interface OpenPosition {
      side: 'long' | 'short'
      qty: number
      price: number
      time: Date
      orderId: string
    }

    const openPositions: OpenPosition[] = []

    for (const row of groupRows) {
      const dt = parseDateTime(row.dateTime)
      const isBuy = row.side.toLowerCase() === 'buy'
      let remainingQty = row.qty

      // Determine if this closes existing positions or opens new ones
      // A Buy closes short positions, a Sell closes long positions
      while (remainingQty > 0 && openPositions.length > 0) {
        const top = openPositions[0]
        const isClosing =
          (isBuy && top.side === 'short') ||
          (!isBuy && top.side === 'long')

        if (!isClosing) break

        const matchQty = Math.min(remainingQty, top.qty)
        remainingQty -= matchQty
        top.qty -= matchQty

        // Calculate P&L for this matched quantity
        const direction = top.side
        const entryPrice = top.price
        const exitPrice = row.price
        const pnlPerContract =
          direction === 'long'
            ? (exitPrice - entryPrice) * 50
            : (entryPrice - exitPrice) * 50
        const grossPnl = pnlPerContract * matchQty
        // Commission: $2.05 per side per contract = $4.10 round trip
        const commission = matchQty * 4.10

        const tradeDate = formatDate(top.time)
        parsedTrades.push({
          date: tradeDate,
          entry_time: top.time.toISOString(),
          exit_time: dt.toISOString(),
          direction,
          quantity: matchQty,
          entry_price: entryPrice,
          exit_price: exitPrice,
          gross_pnl: Math.round(grossPnl * 100) / 100,
          commission: Math.round(commission * 100) / 100,
          net_pnl: Math.round((grossPnl - commission) * 100) / 100,
          tradovate_order_id: `${top.orderId}_${row.orderId}`,
        })

        if (top.qty === 0) {
          openPositions.shift()
        }
      }

      // Any remaining qty opens a new position
      if (remainingQty > 0) {
        openPositions.push({
          side: isBuy ? 'long' : 'short',
          qty: remainingQty,
          price: row.price,
          time: dt,
          orderId: row.orderId,
        })
      }
    }
  }

  // Sort final results by date + entry_time
  parsedTrades.sort((a, b) => {
    const da = new Date(a.entry_time).getTime()
    const db = new Date(b.entry_time).getTime()
    return da - db
  })

  return parsedTrades
}
