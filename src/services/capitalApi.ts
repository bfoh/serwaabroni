import { supabase } from '@/lib/supabase'
import type { CapitalInjection, RepaymentInstallment, CapitalSource } from '@/lib/supabase'
import { generateInstallments } from '@/lib/capitalRisk'

async function uidOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

export async function fetchInjections(): Promise<CapitalInjection[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('capital_injections')
    .select('*')
    .eq('user_id', uid)
    .order('injection_date', { ascending: false })
  if (error) throw error
  return (data as CapitalInjection[]) || []
}

export async function fetchInjection(id: string): Promise<CapitalInjection | null> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('capital_injections').select('*').eq('id', id).eq('user_id', uid).single()
  if (error && error.code !== 'PGRST116') throw error
  return (data as CapitalInjection) ?? null
}

export async function createInjection(input: {
  source: CapitalSource
  lender_name: string | null
  principal: number
  interest_amount: number
  injection_date: string
  payback_months: number
  installment_count: number
  notes: string | null
}): Promise<CapitalInjection> {
  const uid = await uidOrThrow()
  const total_repayable = Math.round((input.principal + input.interest_amount) * 100) / 100

  const { data, error } = await supabase
    .from('capital_injections')
    .insert({ ...input, user_id: uid, total_repayable })
    .select()
    .single()
  if (error) throw error
  const injection = data as CapitalInjection

  // Generate the schedule.
  const rows = generateInstallments(total_repayable, input.installment_count, input.injection_date)
    .map((r) => ({ ...r, user_id: uid, injection_id: injection.id }))
  const { error: insErr } = await supabase.from('repayment_installments').insert(rows)
  if (insErr) throw insErr

  return injection
}

export async function fetchInstallments(injectionId: string): Promise<RepaymentInstallment[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('repayment_installments')
    .select('*')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
    .order('seq', { ascending: true })
  if (error) throw error
  return (data as RepaymentInstallment[]) || []
}

// Cumulative profit recovered from the stock this injection funded — the one
// query that powers the risk engine and the report.
export async function fetchRecoveredProfit(injectionId: string): Promise<number> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('batch_consumptions')
    .select('profit')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
  if (error) throw error
  return (data || []).reduce((s, r: { profit: number }) => s + (r.profit || 0), 0)
}

// Raw consumption rows for the weekly report (shape matches ReportConsumption).
export async function fetchConsumptions(injectionId: string): Promise<{ created_at: string; qty: number; profit: number }[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('batch_consumptions')
    .select('created_at, qty, profit')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as { created_at: string; qty: number; profit: number }[]) || []
}

// Recovered profit for several injections at once (for the list view). Returns a
// map injectionId -> profit.
export async function fetchRecoveredProfitMap(injectionIds: string[]): Promise<Record<string, number>> {
  const uid = await uidOrThrow()
  if (injectionIds.length === 0) return {}
  const { data, error } = await supabase
    .from('batch_consumptions')
    .select('injection_id, profit')
    .in('injection_id', injectionIds)
    .eq('user_id', uid)
  if (error) throw error
  const map: Record<string, number> = {}
  for (const r of (data as { injection_id: string; profit: number }[]) || []) {
    map[r.injection_id] = (map[r.injection_id] || 0) + (r.profit || 0)
  }
  return map
}

// Stock bought with this injection + how much of each batch has sold.
export interface FundedStockRow {
  product_id: string
  product_name: string
  qty_purchased: number
  qty_sold: number
  turnover: number
  profit: number
}

export async function fetchFundedStock(injectionId: string): Promise<FundedStockRow[]> {
  const uid = await uidOrThrow()
  const { data: batches, error } = await supabase
    .from('stock_batches')
    .select('id, product_id, qty_purchased, qty_remaining, products(name)')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
  if (error) throw error

  const { data: cons } = await supabase
    .from('batch_consumptions')
    .select('batch_id, qty, unit_price, profit')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)

  const consByBatch = new Map<string, { qty: number; turnover: number; profit: number }>()
  for (const c of (cons as { batch_id: string; qty: number; unit_price: number; profit: number }[]) || []) {
    const agg = consByBatch.get(c.batch_id) || { qty: 0, turnover: 0, profit: 0 }
    agg.qty += c.qty
    agg.turnover += c.qty * c.unit_price
    agg.profit += c.profit
    consByBatch.set(c.batch_id, agg)
  }

  return ((batches as unknown as {
    id: string; product_id: string; qty_purchased: number; products: { name: string } | null
  }[]) || []).map((b) => {
    const agg = consByBatch.get(b.id) || { qty: 0, turnover: 0, profit: 0 }
    return {
      product_id: b.product_id,
      product_name: b.products?.name ?? 'Unknown',
      qty_purchased: b.qty_purchased,
      qty_sold: agg.qty,
      turnover: Math.round(agg.turnover * 100) / 100,
      profit: Math.round(agg.profit * 100) / 100,
    }
  })
}

// Record a repayment against the earliest unpaid installment(s), and bump the
// injection's amount_repaid. Mirrors the Debts partial-payment flow.
export async function recordInstallmentPayment(injectionId: string, amount: number): Promise<void> {
  const uid = await uidOrThrow()
  const installments = await fetchInstallments(injectionId)
  let left = amount
  const nowIso = new Date().toISOString()

  for (const inst of installments) {
    if (left <= 0) break
    const owed = inst.amount_due - inst.amount_paid
    if (owed <= 0) continue
    const pay = Math.min(owed, left)
    const newPaid = inst.amount_paid + pay
    const fully = newPaid >= inst.amount_due
    await supabase
      .from('repayment_installments')
      .update({ amount_paid: newPaid, status: fully ? 'paid' : 'due', paid_at: fully ? nowIso : inst.paid_at })
      .eq('id', inst.id).eq('user_id', uid)
    left -= pay
  }

  const injection = await fetchInjection(injectionId)
  if (injection) {
    const newRepaid = Math.round((injection.amount_repaid + (amount - Math.max(0, left))) * 100) / 100
    const status = newRepaid >= injection.total_repayable ? 'repaid' : injection.status
    await supabase
      .from('capital_injections')
      .update({ amount_repaid: newRepaid, status })
      .eq('id', injectionId).eq('user_id', uid)
  }
}

export async function updateInjectionRisk(injectionId: string, tier: string): Promise<void> {
  const uid = await uidOrThrow()
  await supabase.from('capital_injections').update({ risk_tier: tier }).eq('id', injectionId).eq('user_id', uid)
}
