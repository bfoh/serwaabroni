// Pure profit-recovery arithmetic for capital injections. A consumption's profit
// counts toward its loan only to the extent the cash has actually arrived: cash
// sales fully, credit sales by the fraction of the tab paid. Kept Supabase-free
// so it is unit-testable.

export interface RecoveryConsumption { injection_id: string; sale_id: string; profit: number }
export interface RecoverySale { sale_group_id: string | null; payment_method: string; created_at: string }
export interface RecoveryTab { amount: number; amount_paid: number; payments: { amount: number; date: string }[] }

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function paidFraction(
  sale: RecoverySale | undefined,
  tabsByGroup: Record<string, RecoveryTab>,
  sinceIso?: string,
): number {
  // Missing sale row — count fully (we can't withhold what we can't identify).
  if (!sale) return 1

  if (sale.payment_method !== 'credit') {
    if (sinceIso && sale.created_at < sinceIso) return 0
    return 1
  }

  const tab = sale.sale_group_id ? tabsByGroup[sale.sale_group_id] : undefined
  // Credit sale with no tab — treat as fully paid.
  if (!tab) return 1
  if (tab.amount <= 0) return 0

  if (!sinceIso) return clamp01(tab.amount_paid / tab.amount)

  const paidInPeriod = (tab.payments || [])
    .filter((p) => p.date >= sinceIso)
    .reduce((s, p) => s + p.amount, 0)
  return clamp01(paidInPeriod / tab.amount)
}

export function computeRecovered(
  consumptions: RecoveryConsumption[],
  salesById: Record<string, RecoverySale>,
  tabsByGroup: Record<string, RecoveryTab>,
  sinceIso?: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of consumptions) {
    const fraction = paidFraction(salesById[c.sale_id], tabsByGroup, sinceIso)
    if (fraction === 0) continue
    out[c.injection_id] = (out[c.injection_id] || 0) + c.profit * fraction
  }
  return out
}
