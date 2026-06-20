import type { CashAccount } from './cashBalances'

// Map a sale to the cash inflow it produces. cash→cash; momo/bank→bank;
// credit→only the deposit, to cash (the rest is a receivable). Returns null when
// no cash actually arrives (credit with no deposit).
export function saleMovement(
  method: string, total: number, deposit: number,
): { account: CashAccount; amount: number } | null {
  if (method === 'credit') return deposit > 0 ? { account: 'cash', amount: deposit } : null
  if (method === 'momo' || method === 'bank') return { account: 'bank', amount: total }
  return { account: 'cash', amount: total }
}
