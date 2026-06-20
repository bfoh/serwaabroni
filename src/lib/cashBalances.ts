// Pure: fold cash_movements rows into the two account balances. Supabase-free so
// it is unit-testable.
export type CashAccount = 'cash' | 'bank'
export interface CashBalances { cash: number; bank: number }

export function computeBalances(
  rows: { account: CashAccount; direction: 'in' | 'out'; amount: number }[],
): CashBalances {
  const bal: CashBalances = { cash: 0, bank: 0 }
  for (const r of rows) {
    const delta = r.direction === 'in' ? r.amount : -r.amount
    if (r.account === 'cash') bal.cash += delta
    else bal.bank += delta
  }
  bal.cash = Math.round(bal.cash * 100) / 100
  bal.bank = Math.round(bal.bank * 100) / 100
  return bal
}
