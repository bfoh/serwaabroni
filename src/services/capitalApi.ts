import { supabase } from '@/lib/supabase'
import type { CapitalInjection, RepaymentInstallment, CapitalSource } from '@/lib/supabase'
import { generateInstallments, generateInterestOnlyInstallments, computeRisk } from '@/lib/capitalRisk'
import { summarizeInjectionStock } from '@/lib/capitalStock'
import type { InjectionStockSummary } from '@/lib/capitalStock'
import { computeRecovered, type RecoverySale, type RecoveryTab } from '@/lib/capitalRecovery'
import { splitCreditReceivables, type ReceivableConsumption, type ReceivableTab } from '@/lib/capitalReceivables'

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
  repayment_type: 'equal' | 'interest_only'
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
  const generated = input.repayment_type === 'interest_only'
    ? generateInterestOnlyInstallments(input.principal, input.interest_amount, input.installment_count, input.injection_date)
    : generateInstallments(total_repayable, input.installment_count, input.injection_date)
  const rows = generated.map((r) => ({ ...r, user_id: uid, injection_id: injection.id }))
  const { error: insErr } = await supabase.from('repayment_installments').insert(rows)
  if (insErr) throw insErr

  return injection
}

export async function deleteInjection(id: string): Promise<void> {
  const uid = await uidOrThrow()
  // supabase RLS cascades deleting repayment_installments if defined, 
  // but if not, we should probably delete the installments first just in case.
  await supabase.from('repayment_installments').delete().eq('injection_id', id).eq('user_id', uid)
  
  const { error } = await supabase.from('capital_injections').delete().eq('id', id).eq('user_id', uid)
  if (error) throw error
}

export async function updateInjection(id: string, updates: {
  source?: CapitalSource
  lender_name?: string | null
  principal?: number
  interest_amount?: number
  payback_months?: number
  repayment_type?: 'equal' | 'interest_only'
}): Promise<void> {
  const uid = await uidOrThrow()
  
  // If principal or interest changed, we need to recalculate total_repayable
  // and possibly regenerate the schedule if payback_months also changed.
  const injection = await fetchInjection(id)
  if (!injection) throw new Error('Injection not found')

  const newPrincipal = updates.principal ?? injection.principal
  const newInterest = updates.interest_amount ?? injection.interest_amount
  const newMonths = updates.payback_months ?? injection.payback_months
  const newType = updates.repayment_type ?? injection.repayment_type
  const total_repayable = Math.round((newPrincipal + newInterest) * 100) / 100

  const { error } = await supabase
    .from('capital_injections')
    .update({ 
      ...updates, 
      total_repayable,
      amount_repaid: Math.min(injection.amount_repaid, total_repayable) // Cap repaid at new total
    })
    .eq('id', id)
    .eq('user_id', uid)
  
  if (error) throw error

  // If financial parameters changed, regenerate the future schedule?
  // For simplicity, if these core params change, we recreate the schedule
  // but keep the `amount_paid` intact. 
  if (updates.principal !== undefined || updates.interest_amount !== undefined || updates.payback_months !== undefined || updates.repayment_type !== undefined) {
    await supabase.from('repayment_installments').delete().eq('injection_id', id).eq('user_id', uid)
    const generated = newType === 'interest_only'
      ? generateInterestOnlyInstallments(newPrincipal, newInterest, newMonths, injection.injection_date)
      : generateInstallments(total_repayable, newMonths, injection.injection_date)
    const rows = generated
      .map((r) => ({
        ...r, 
        user_id: uid, 
        injection_id: injection.id, 
        amount_paid: 0, 
        status: 'due' as 'due' | 'paid' | 'overdue' 
      }))
    
    // Distribute existing amount_repaid across the new schedule
    let leftToApply = injection.amount_repaid
    for (const r of rows) {
      if (leftToApply <= 0) break
      const pay = Math.min(leftToApply, r.amount_due)
      r.amount_paid = pay
      r.status = pay >= r.amount_due ? 'paid' : 'due'
      leftToApply -= pay
    }

    await supabase.from('repayment_installments').insert(rows)
  }
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

// Cumulative profit recovered from the stock this injection funded, withholding
// credit sales until paid. Powers the risk engine and the report.
export async function fetchRecoveredProfit(injectionId: string): Promise<number> {
  const map = await fetchRecoveredProfitMap([injectionId])
  return map[injectionId] || 0
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

// Recovered profit per injection. Pass sinceIso to restrict to a period (credit
// profit is then counted by when its payments landed, not when goods left).
export async function fetchRecoveredProfitMap(injectionIds: string[], sinceIso?: string): Promise<Record<string, number>> {
  const uid = await uidOrThrow()
  if (injectionIds.length === 0) return {}

  // 1. Consumptions of these injections.
  const { data: consData, error } = await supabase
    .from('batch_consumptions')
    .select('injection_id, sale_id, profit')
    .in('injection_id', injectionIds)
    .eq('user_id', uid)
  if (error) throw error
  const consumptions = (consData as { injection_id: string; sale_id: string; profit: number }[] | null) || []
  if (consumptions.length === 0) return {}

  // 2. The sales those consumptions belong to (for method + group).
  const saleIds = Array.from(new Set(consumptions.map((c) => c.sale_id).filter(Boolean)))
  const salesById: Record<string, RecoverySale> = {}
  if (saleIds.length) {
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, sale_group_id, payment_method, created_at')
      .in('id', saleIds)
      .eq('user_id', uid)
    for (const s of (salesData as { id: string; sale_group_id: string | null; payment_method: string; created_at: string }[] | null) || []) {
      salesById[s.id] = { sale_group_id: s.sale_group_id, payment_method: s.payment_method, created_at: s.created_at }
    }
  }

  // 3. Credit tabs for the credit sales, keyed by sale_group_id.
  const creditGroups = Array.from(new Set(
    Object.values(salesById)
      .filter((s) => s.payment_method === 'credit' && s.sale_group_id)
      .map((s) => s.sale_group_id as string),
  ))
  const tabsByGroup: Record<string, RecoveryTab> = {}
  if (creditGroups.length) {
    const { data: tabsData } = await supabase
      .from('debts')
      .select('sale_group_id, amount, amount_paid, payments')
      .in('sale_group_id', creditGroups)
      .eq('user_id', uid)
    for (const t of (tabsData as { sale_group_id: string; amount: number; amount_paid: number | null; payments: { amount: number; date: string }[] | null }[] | null) || []) {
      tabsByGroup[t.sale_group_id] = { amount: t.amount, amount_paid: t.amount_paid || 0, payments: t.payments || [] }
    }
  }

  return computeRecovered(consumptions, salesById, tabsByGroup, sinceIso)
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

// ── Receivables: customers who owe against a loan ────────────────────────────
// Two sources are unioned per loan:
//  • manual debts tagged injection_id = X (shown at full outstanding)
//  • credit-sale debts whose cart consumed stock from X (shown at the loan's
//    share of the tab — its lines' selling value / tab total)
export interface InjectionReceivable {
  id: string
  person_name: string
  phone: string | null
  outstanding: number
  fullOutstanding: number
  fullAmount: number
  isCredit: boolean
  is_paid: boolean
  due_date: string | null
}

// Builds attributable receivable rows per injection for the given ids.
async function fetchReceivablesDetail(injectionIds: string[]): Promise<Record<string, InjectionReceivable[]>> {
  const uid = await uidOrThrow()
  const result: Record<string, InjectionReceivable[]> = {}
  if (injectionIds.length === 0) return result

  // — Manual debts: directly tagged to a loan, not from a sale —
  const { data: manualData, error: manualErr } = await supabase
    .from('debts')
    .select('id, person_name, phone, amount, amount_paid, is_paid, due_date, injection_id')
    .in('injection_id', injectionIds)
    .eq('user_id', uid)
    .eq('type', 'owed')
    .is('sale_group_id', null)
    .eq('is_paid', false)
  if (manualErr) throw manualErr
  for (const d of (manualData as { id: string; person_name: string; phone: string | null; amount: number; amount_paid: number | null; is_paid: boolean; due_date: string | null; injection_id: string }[] | null) || []) {
    const outstanding = Math.max(0, d.amount - (d.amount_paid || 0))
    ;(result[d.injection_id] ||= []).push({
      id: d.id, person_name: d.person_name, phone: d.phone,
      outstanding, fullOutstanding: outstanding, fullAmount: d.amount,
      isCredit: false, is_paid: d.is_paid, due_date: d.due_date,
    })
  }

  // — Credit-sale debts: reached via the loan's consumed stock —
  const { data: consData } = await supabase
    .from('batch_consumptions')
    .select('injection_id, sale_id, qty, unit_price')
    .in('injection_id', injectionIds)
    .eq('user_id', uid)
  const cons = (consData as { injection_id: string; sale_id: string; qty: number; unit_price: number }[] | null) || []
  if (cons.length) {
    const saleIds = Array.from(new Set(cons.map((c) => c.sale_id).filter(Boolean)))
    const groupBySale: Record<string, string | null> = {}
    const methodBySale: Record<string, string> = {}
    if (saleIds.length) {
      const { data: salesData } = await supabase
        .from('sales')
        .select('id, sale_group_id, payment_method')
        .in('id', saleIds)
        .eq('user_id', uid)
      for (const s of (salesData as { id: string; sale_group_id: string | null; payment_method: string }[] | null) || []) {
        groupBySale[s.id] = s.sale_group_id
        methodBySale[s.id] = s.payment_method
      }
    }
    // Keep only consumptions belonging to a credit sale with a group id.
    const recvCons: ReceivableConsumption[] = cons
      .filter((c) => methodBySale[c.sale_id] === 'credit' && groupBySale[c.sale_id])
      .map((c) => ({ injection_id: c.injection_id, sale_group_id: groupBySale[c.sale_id] as string, lineValue: c.qty * c.unit_price }))

    const creditGroups = Array.from(new Set(recvCons.map((c) => c.sale_group_id)))
    const tabsByGroup: Record<string, ReceivableTab> = {}
    const tabMeta: Record<string, { id: string; person_name: string; phone: string | null; due_date: string | null }> = {}
    if (creditGroups.length) {
      const { data: tabsData } = await supabase
        .from('debts')
        .select('id, sale_group_id, person_name, phone, amount, amount_paid, is_paid, due_date')
        .in('sale_group_id', creditGroups)
        .eq('user_id', uid)
      for (const t of (tabsData as { id: string; sale_group_id: string; person_name: string; phone: string | null; amount: number; amount_paid: number | null; is_paid: boolean; due_date: string | null }[] | null) || []) {
        tabsByGroup[t.sale_group_id] = { sale_group_id: t.sale_group_id, amount: t.amount, amount_paid: t.amount_paid || 0, is_paid: t.is_paid }
        tabMeta[t.sale_group_id] = { id: t.id, person_name: t.person_name, phone: t.phone, due_date: t.due_date }
      }
    }

    const split = splitCreditReceivables(recvCons, tabsByGroup)
    for (const [injectionId, rows] of Object.entries(split)) {
      for (const r of rows) {
        const meta = tabMeta[r.sale_group_id]
        if (!meta) continue
        ;(result[injectionId] ||= []).push({
          id: meta.id, person_name: meta.person_name, phone: meta.phone,
          outstanding: r.shareOutstanding, fullOutstanding: r.fullOutstanding, fullAmount: r.fullAmount,
          isCredit: true, is_paid: false, due_date: meta.due_date,
        })
      }
    }
  }

  return result
}

export async function fetchInjectionReceivables(injectionId: string): Promise<InjectionReceivable[]> {
  const detail = await fetchReceivablesDetail([injectionId])
  return detail[injectionId] || []
}

export async function fetchReceivablesMap(
  injectionIds: string[],
): Promise<Record<string, { outstanding: number; count: number }>> {
  const detail = await fetchReceivablesDetail(injectionIds)
  const map: Record<string, { outstanding: number; count: number }> = {}
  for (const [injectionId, rows] of Object.entries(detail)) {
    map[injectionId] = {
      outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      count: rows.length,
    }
  }
  return map
}

export interface CapitalSummary {
  outstanding: number
  recovered: number
  atRiskCount: number
  activeCount: number
}

export async function fetchCapitalSummary(): Promise<CapitalSummary> {
  const injections = await fetchInjections()
  const active = injections.filter((i) => i.status !== 'repaid')
  const recoveredMap = await fetchRecoveredProfitMap(active.map((i) => i.id))
  const now = new Date().toISOString()

  let atRiskCount = 0
  for (const i of active) {
    const risk = computeRisk({
      injectionDate: i.injection_date,
      paybackMonths: i.payback_months,
      totalRepayable: i.total_repayable,
      recoveredProfit: recoveredMap[i.id] || 0,
      installments: [],
      now,
    })
    if (risk.tier === 'at_risk') atRiskCount++
  }

  return {
    outstanding: active.reduce((s, i) => s + (i.total_repayable - i.amount_repaid), 0),
    recovered: Object.values(recoveredMap).reduce((s, v) => s + v, 0),
    atRiskCount,
    activeCount: active.length,
  }
}

export async function fetchInjectionStockSummary(injectionId: string): Promise<InjectionStockSummary> {
  const uid = await uidOrThrow()
  
  const { data: batches, error: batchesError } = await supabase
    .from('stock_batches')
    .select('product_id, qty_purchased, qty_remaining, unit_cost, total_cost, products(name)')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
  if (batchesError) throw batchesError

  // batch_consumptions has no product_id — it reaches a product via batch_id ->
  // stock_batches.product_id. Embed that relation to attribute realized profit.
  const { data: cons, error: consError } = await supabase
    .from('batch_consumptions')
    .select('qty, profit, stock_batches(product_id)')
    .eq('injection_id', injectionId)
    .eq('user_id', uid)
  if (consError) throw consError

  const productIds = Array.from(new Set((batches as any[] || []).map(b => b.product_id)))
  const sellingPriceById: Record<string, number> = {}

  if (productIds.length > 0) {
    const { data: prods, error: prodError } = await supabase
      .from('products')
      .select('id, selling_price')
      .in('id', productIds)
      .eq('user_id', uid)
    if (prodError) throw prodError
    
    for (const p of prods || []) {
      sellingPriceById[p.id] = p.selling_price
    }
  }

  const batchLites = (batches as any[] || []).map(b => ({
    product_id: b.product_id,
    product_name: b.products?.name ?? 'Unknown',
    qty_purchased: b.qty_purchased,
    qty_remaining: b.qty_remaining,
    unit_cost: b.unit_cost,
    total_cost: b.total_cost,
  }))

  const consLites = (cons as any[] || [])
    .map(c => ({
      // Embedded relation may come back as an object or a single-element array.
      product_id: Array.isArray(c.stock_batches) ? c.stock_batches[0]?.product_id : c.stock_batches?.product_id,
      qty: c.qty,
      profit: c.profit,
    }))
    .filter(c => c.product_id) // drop untracked oversell rows (no batch)

  return summarizeInjectionStock(batchLites, consLites, sellingPriceById)
}

export async function updateInjectionRisk(injectionId: string, tier: string): Promise<void> {
  const uid = await uidOrThrow()
  await supabase.from('capital_injections').update({ risk_tier: tier }).eq('id', injectionId).eq('user_id', uid)
}
