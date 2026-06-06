import { supabase } from '@/lib/supabase'
import type { StockBatch } from '@/lib/supabase'
import { allocateFifo, type FifoBatch, type FifoResult } from '@/lib/fifo'

async function uidOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

// Create a batch when stock is received. injectionId links it to capital (Plan 2);
// pass null for an ordinary restock.
export async function receiveStock(params: {
  productId: string
  qty: number
  unitCost: number
  injectionId?: string | null
  purchasedAt?: string
}): Promise<StockBatch> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('stock_batches')
    .insert({
      user_id: uid,
      product_id: params.productId,
      injection_id: params.injectionId ?? null,
      qty_purchased: params.qty,
      qty_remaining: params.qty,
      unit_cost: params.unitCost,
      total_cost: Math.round(params.unitCost * params.qty * 100) / 100,
      purchased_at: params.purchasedAt ?? new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data as StockBatch
}

// A product's open batches, oldest first — the FIFO input.
export async function fetchOpenBatches(productId: string): Promise<FifoBatch[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('stock_batches')
    .select('id, qty_remaining, unit_cost, injection_id')
    .eq('user_id', uid)
    .eq('product_id', productId)
    .gt('qty_remaining', 0)
    .order('purchased_at', { ascending: true })
  if (error) throw error
  return (data as FifoBatch[]) || []
}

// Apply a sale's FIFO draws: write consumption rows and decrement batch stock.
// Returns the FifoResult so the caller can use the true profit (sum of draws).
export async function consumeForSale(params: {
  saleId: string
  productId: string
  quantity: number
  unitPrice: number
}): Promise<FifoResult> {
  const uid = await uidOrThrow()
  const batches = await fetchOpenBatches(params.productId)
  const result = allocateFifo(batches, params.quantity, params.unitPrice)

  // One consumption row per real batch draw...
  const rows: {
    user_id: string
    sale_id: string
    batch_id: string | null
    injection_id: string | null
    qty: number
    unit_cost: number
    unit_price: number
    profit: number
  }[] = result.draws.map((d) => ({
    user_id: uid,
    sale_id: params.saleId,
    batch_id: d.batch_id,
    injection_id: d.injection_id,
    qty: d.qty,
    unit_cost: d.unit_cost,
    unit_price: d.unit_price,
    profit: d.profit,
  }))
  // ...plus an untracked row if the sale oversold tracked stock, so totals reconcile.
  if (result.untrackedQty > 0) {
    rows.push({
      user_id: uid,
      sale_id: params.saleId,
      batch_id: null,
      injection_id: null,
      qty: result.untrackedQty,
      unit_cost: 0,
      unit_price: params.unitPrice,
      profit: Math.round(params.unitPrice * result.untrackedQty * 100) / 100,
    })
  }
  if (rows.length > 0) {
    const { error } = await supabase.from('batch_consumptions').insert(rows)
    if (error) throw error
  }

  // Decrement qty_remaining per drawn batch.
  for (const d of result.draws) {
    const batch = batches.find((b) => b.id === d.batch_id)
    if (!batch) continue
    const { error } = await supabase
      .from('stock_batches')
      .update({ qty_remaining: batch.qty_remaining - d.qty })
      .eq('id', d.batch_id)
      .eq('user_id', uid)
    if (error) throw error
  }

  return result
}

// Reverse a deleted sale: restore each batch's qty_remaining, then drop the rows.
export async function reverseConsumptions(saleIds: string[]): Promise<void> {
  const uid = await uidOrThrow()
  if (saleIds.length === 0) return

  const { data: cons, error: readErr } = await supabase
    .from('batch_consumptions')
    .select('id, batch_id, qty')
    .in('sale_id', saleIds)
    .eq('user_id', uid)
  if (readErr) throw readErr
  if (!cons || cons.length === 0) return

  // Restore stock per batch (skip untracked rows where batch_id is null).
  const restoreByBatch = new Map<string, number>()
  for (const c of cons as { id: string; batch_id: string | null; qty: number }[]) {
    if (!c.batch_id) continue
    restoreByBatch.set(c.batch_id, (restoreByBatch.get(c.batch_id) || 0) + c.qty)
  }
  if (restoreByBatch.size > 0) {
    const { data: batches } = await supabase
      .from('stock_batches')
      .select('id, qty_remaining')
      .in('id', Array.from(restoreByBatch.keys()))
      .eq('user_id', uid)
    await Promise.all(
      ((batches as { id: string; qty_remaining: number }[]) || []).map((b) =>
        supabase
          .from('stock_batches')
          .update({ qty_remaining: (b.qty_remaining || 0) + (restoreByBatch.get(b.id) || 0) })
          .eq('id', b.id)
          .eq('user_id', uid)
      )
    )
  }

  const { error: delErr } = await supabase
    .from('batch_consumptions')
    .delete()
    .in('sale_id', saleIds)
    .eq('user_id', uid)
  if (delErr) throw delErr
}
