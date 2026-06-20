import { supabase } from '@/lib/supabase'
import { computeBalances, type CashAccount, type CashBalances } from '@/lib/cashBalances'

async function uidOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

export type CashCategory =
  | 'sale' | 'debtor_payment' | 'expense' | 'loan_repayment' | 'debt_repayment'
  | 'stock_purchase' | 'bank_deposit' | 'bank_withdrawal' | 'adjustment'

export interface CashMovement {
  id: string; user_id: string; account: CashAccount; direction: 'in' | 'out'
  amount: number; category: CashCategory; ref_table: string | null
  ref_id: string | null; transfer_id: string | null; note: string | null; created_at: string
}

export interface NewMovement {
  account: CashAccount; direction: 'in' | 'out'; amount: number; category: CashCategory
  ref_table?: string | null; ref_id?: string | null; transfer_id?: string | null
  note?: string | null; created_at?: string
}

export async function fetchMovements(limit = 200): Promise<CashMovement[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('cash_movements')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as CashMovement[]) || []
}

export async function fetchBalances(): Promise<CashBalances> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('cash_movements')
    .select('account, direction, amount')
    .eq('user_id', uid)
  if (error) throw error
  return computeBalances((data as { account: CashAccount; direction: 'in' | 'out'; amount: number }[]) || [])
}

export async function postMovement(m: NewMovement): Promise<void> {
  const uid = await uidOrThrow()
  if (!m.amount || m.amount <= 0) return // never post a zero/negative row
  const { error } = await supabase.from('cash_movements').insert({
    user_id: uid,
    account: m.account,
    direction: m.direction,
    amount: Math.round(m.amount * 100) / 100,
    category: m.category,
    ref_table: m.ref_table ?? null,
    ref_id: m.ref_id ?? null,
    transfer_id: m.transfer_id ?? null,
    note: m.note ?? null,
    created_at: m.created_at ?? new Date().toISOString(),
  })
  if (error) throw error
}

export async function deleteMovementsByRef(refTable: string, refId: string): Promise<void> {
  const uid = await uidOrThrow()
  const { error } = await supabase
    .from('cash_movements')
    .delete()
    .eq('user_id', uid)
    .eq('ref_table', refTable)
    .eq('ref_id', refId)
  if (error) throw error
}

// A transfer is two legs (out of `from`, into `to`) sharing one transfer_id.
export async function postTransfer(from: CashAccount, to: CashAccount, amount: number, note?: string | null): Promise<void> {
  const uid = await uidOrThrow()
  if (!amount || amount <= 0) return
  const transfer_id = crypto.randomUUID()
  const amt = Math.round(amount * 100) / 100
  const category: CashCategory = to === 'bank' ? 'bank_deposit' : 'bank_withdrawal'
  const { error } = await supabase.from('cash_movements').insert([
    { user_id: uid, account: from, direction: 'out', amount: amt, category, transfer_id, note: note ?? null },
    { user_id: uid, account: to,   direction: 'in',  amount: amt, category, transfer_id, note: note ?? null },
  ])
  if (error) throw error
}
