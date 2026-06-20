// Pure share-split arithmetic for "owed by customers" against a loan. When one
// credit cart drew on stock from several loans, the customer owes ONE tab; each
// loan's slice of that tab is its share of the cart's selling value. Supabase-free
// so it is unit-testable.

export interface ReceivableConsumption { injection_id: string; sale_group_id: string; lineValue: number }
export interface ReceivableTab { sale_group_id: string; amount: number; amount_paid: number; is_paid: boolean }
export interface ReceivableRow { sale_group_id: string; shareOutstanding: number; fullOutstanding: number; fullAmount: number }

export function splitCreditReceivables(
  consumptions: ReceivableConsumption[],
  tabsByGroup: Record<string, ReceivableTab>,
): Record<string, ReceivableRow[]> {
  // numerator[injection][group] = selling value of this loan's lines in that cart
  const numerator = new Map<string, Map<string, number>>()
  for (const c of consumptions) {
    const byGroup = numerator.get(c.injection_id) ?? new Map<string, number>()
    byGroup.set(c.sale_group_id, (byGroup.get(c.sale_group_id) || 0) + c.lineValue)
    numerator.set(c.injection_id, byGroup)
  }

  const out: Record<string, ReceivableRow[]> = {}
  for (const [injectionId, byGroup] of numerator) {
    const rows: ReceivableRow[] = []
    for (const [groupId, lineSum] of byGroup) {
      const tab = tabsByGroup[groupId]
      if (!tab || tab.is_paid || tab.amount <= 0) continue
      const share = lineSum / tab.amount
      const fullOutstanding = tab.amount - tab.amount_paid
      rows.push({
        sale_group_id: groupId,
        shareOutstanding: fullOutstanding * share,
        fullOutstanding,
        fullAmount: tab.amount,
      })
    }
    if (rows.length) out[injectionId] = rows
  }
  return out
}
