export interface GeneratedInstallment {
  seq: number
  due_date: string
  amount_due: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Add whole months in UTC so results are independent of the machine timezone
// (local-time month math + toISOString can silently shift the day by one).
function addMonthsUtc(iso: string, months: number): Date {
  const d = new Date(iso)
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  ))
}

// Equal monthly installments; the last absorbs the rounding remainder so the
// installments sum exactly to total.
export function generateInstallments(
  total: number,
  count: number,
  injectionDateIso: string
): GeneratedInstallment[] {
  const base = round2(total / count)
  const rows: GeneratedInstallment[] = []
  for (let i = 1; i <= count; i++) {
    const amount = i === count ? round2(total - base * (count - 1)) : base
    rows.push({
      seq: i,
      due_date: addMonthsUtc(injectionDateIso, i).toISOString(),
      amount_due: amount,
    })
  }
  return rows
}
