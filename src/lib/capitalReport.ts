export interface ReportConsumption {
  created_at: string
  qty: number
  profit: number
  product_name?: string | null
  unit_price?: number
}

// One underlying sale line that contributes to a week's total.
export interface WeeklyReportLine {
  date: string
  productName: string
  qty: number
  turnover: number
  profit: number
}

export interface WeeklyReportRow {
  week: string          // ISO year-week, e.g. "2026-W03"
  profit: number        // profit recovered that week
  units: number         // units of funded stock sold that week
  cumulative: number    // total recovered profit up to and including this week
  deltaVsPrev: number   // this week's profit minus the previous week's
  lines: WeeklyReportLine[] // the individual sales behind this week, newest first
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ISO-8601 week key (UTC). Weeks start Monday; week 1 contains the year's first
// Thursday. Returns e.g. "2026-W03".
export function isoWeekKey(iso: string): string {
  const d = new Date(iso)
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  // Thursday of the current week decides the ISO year.
  const day = date.getUTCDay() || 7 // Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const isoYear = date.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

// Bucket consumptions into ISO weeks. Returns rows newest-week-first; cumulative
// and deltaVsPrev are computed in chronological order then the list is reversed.
export function buildWeeklyReport(consumptions: ReportConsumption[]): WeeklyReportRow[] {
  const byWeek = new Map<string, { profit: number; units: number; lines: WeeklyReportLine[] }>()
  for (const c of consumptions) {
    const key = isoWeekKey(c.created_at)
    const agg = byWeek.get(key) || { profit: 0, units: 0, lines: [] }
    agg.profit += c.profit
    agg.units += c.qty
    agg.lines.push({
      date: c.created_at,
      productName: c.product_name || 'Item',
      qty: c.qty,
      turnover: round2(c.qty * (c.unit_price || 0)),
      profit: round2(c.profit),
    })
    byWeek.set(key, agg)
  }

  const weeksAsc = Array.from(byWeek.keys()).sort() // ISO week keys sort chronologically
  const rows: WeeklyReportRow[] = []
  let cumulative = 0
  let prevProfit = 0
  for (const week of weeksAsc) {
    const { profit, units, lines } = byWeek.get(week)!
    cumulative = round2(cumulative + profit)
    rows.push({
      week,
      profit: round2(profit),
      units,
      cumulative,
      deltaVsPrev: round2(profit - prevProfit),
      lines: lines.sort((a, b) => b.date.localeCompare(a.date)), // newest first within the week
    })
    prevProfit = profit
  }
  return rows.reverse() // newest first
}
