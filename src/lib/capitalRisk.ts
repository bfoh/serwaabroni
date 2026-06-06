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

// Interest-only schedule with a final balloon. Each month pays an equal slice of
// the interest; the last interest slice absorbs the rounding remainder so the
// interest slices sum exactly to `interest`. The final month additionally carries
// the full principal. Total still sums to principal + interest.
export function generateInterestOnlyInstallments(
  principal: number,
  interest: number,
  count: number,
  injectionDateIso: string
): GeneratedInstallment[] {
  const baseInterest = round2(interest / count)
  const rows: GeneratedInstallment[] = []
  for (let i = 1; i <= count; i++) {
    const interestSlice = i === count
      ? round2(interest - baseInterest * (count - 1))
      : baseInterest
    const amount = i === count ? round2(interestSlice + principal) : interestSlice
    rows.push({
      seq: i,
      due_date: addMonthsUtc(injectionDateIso, i).toISOString(),
      amount_due: amount,
    })
  }
  return rows
}

export interface RiskInstallment {
  due_date: string
  amount_due: number
  amount_paid: number
}

export interface RiskInput {
  injectionDate: string
  paybackMonths: number
  totalRepayable: number
  recoveredProfit: number
  installments: RiskInstallment[]
  now: string
}

export type RiskTier = 'on_track' | 'watch' | 'at_risk'

export interface RiskResult {
  tier: RiskTier
  recoveredProfit: number
  projected: number
  recoveryRatio: number      // recoveredProfit / totalRepayable
  linearTargetNow: number    // where recovery "should" be by now
  shortfall: number          // max(0, total - projected)
  daysLeft: number
  requiredProfitPerWeek: number // to close the shortfall by the deadline
  hasOverdueInstallment: boolean
}

const DAY = 1000 * 60 * 60 * 24

export function computeRisk(input: RiskInput): RiskResult {
  const start = new Date(input.injectionDate).getTime()
  const deadline = addMonthsUtc(input.injectionDate, input.paybackMonths).getTime()
  const now = new Date(input.now).getTime()

  const totalDays = Math.max(1, (deadline - start) / DAY)
  const daysElapsed = Math.max(1, (now - start) / DAY)
  const daysLeft = Math.max(0, (deadline - now) / DAY)

  const pace = input.recoveredProfit / daysElapsed
  const projected = round2(pace * totalDays)
  const linearTargetNow = round2(input.totalRepayable * (daysElapsed / totalDays))
  const recoveryRatio = input.totalRepayable > 0 ? input.recoveredProfit / input.totalRepayable : 0
  const shortfall = Math.max(0, round2(input.totalRepayable - projected))

  const hasOverdueInstallment = input.installments.some(
    (i) => new Date(i.due_date).getTime() <= now && i.amount_paid < i.amount_due
  )

  let tier: RiskTier
  if (hasOverdueInstallment) tier = 'at_risk'
  else if (projected >= input.totalRepayable) tier = 'on_track'
  else if (projected >= 0.85 * input.totalRepayable) tier = 'watch'
  else tier = 'at_risk'

  const weeksLeft = Math.max(daysLeft / 7, 0.5)
  const requiredProfitPerWeek = round2(shortfall / weeksLeft)

  return {
    tier,
    recoveredProfit: round2(input.recoveredProfit),
    projected,
    recoveryRatio,
    linearTargetNow,
    shortfall,
    daysLeft: Math.round(daysLeft),
    requiredProfitPerWeek,
    hasOverdueInstallment,
  }
}
