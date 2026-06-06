export interface ReportConsumption {
  created_at: string
  qty: number
  profit: number
}

export interface WeeklyReportRow {
  week: string          // ISO year-week, e.g. "2026-W03"
  profit: number        // profit recovered that week
  units: number         // units of funded stock sold that week
  cumulative: number    // total recovered profit up to and including this week
  deltaVsPrev: number   // this week's profit minus the previous week's
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
  const byWeek = new Map<string, { profit: number; units: number }>()
  for (const c of consumptions) {
    const key = isoWeekKey(c.created_at)
    const agg = byWeek.get(key) || { profit: 0, units: 0 }
    agg.profit += c.profit
    agg.units += c.qty
    byWeek.set(key, agg)
  }

  const weeksAsc = Array.from(byWeek.keys()).sort() // ISO week keys sort chronologically
  const rows: WeeklyReportRow[] = []
  let cumulative = 0
  let prevProfit = 0
  for (const week of weeksAsc) {
    const { profit, units } = byWeek.get(week)!
    cumulative = round2(cumulative + profit)
    rows.push({
      week,
      profit: round2(profit),
      units,
      cumulative,
      deltaVsPrev: round2(profit - prevProfit),
    })
    prevProfit = profit
  }
  return rows.reverse() // newest first
}
