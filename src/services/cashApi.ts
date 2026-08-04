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

// Posts via a SECURITY DEFINER RPC, not a direct insert: cash_movements is
// owner-only RLS (migration_026), but Manager/Staff can record sales/debts/
// expenses, each of which posts a cash entry here. The RPC always writes
// under the caller's resolved business id (never their own id for a
// staff/manager caller), so this is the one legitimate way a non-owner
// action reaches the owner's cash ledger. See migration_028_cash_post_rpc.sql.
export async function postMovement(m: NewMovement): Promise<void> {
  if (!m.amount || m.amount <= 0) return // never post a zero/negative row
  const { error } = await supabase.rpc('post_cash_movement', {
    p_account: m.account,
    p_direction: m.direction,
    p_amount: Math.round(m.amount * 100) / 100,
    p_category: m.category,
    p_ref_table: m.ref_table ?? null,
    p_ref_id: m.ref_id ?? null,
    p_transfer_id: m.transfer_id ?? null,
    p_note: m.note ?? null,
    p_created_at: m.created_at ?? new Date().toISOString(),
  })
  if (error) throw error
}

export async function deleteMovementsByRef(refTable: string, refId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_cash_movements_by_ref', {
    p_ref_table: refTable,
    p_ref_id: refId,
  })
  if (error) throw error
}

// Reverses ONE payment's movement, not every movement sharing a ref: unlike a
// sale's sale_group_id (unique per cash entry), debts.id is shared by every
// partial payment ever made on that debt — deleteMovementsByRef would wipe
// all of them. Used when deleting/undoing a single debt payment. Callers
// that only have the amount to match on (not the movement's own id) should
// use this instead of reading cash_movements client-side: staff/manager
// can never read that table directly (owner-only RLS), so the old
// fetch-then-match-then-delete pattern silently no-op'd for them.
export async function deleteMovementByRefAndAmount(refTable: string, refId: string, amount: number): Promise<void> {
  const { error } = await supabase.rpc('delete_cash_movement_by_ref_amount', {
    p_ref_table: refTable,
    p_ref_id: refId,
    p_amount: Math.round(amount * 100) / 100,
  })
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
