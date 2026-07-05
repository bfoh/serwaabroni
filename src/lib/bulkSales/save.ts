import type { Product } from '@/lib/supabase'
import { uid } from '@/lib/data'
import { saleMovement } from '@/lib/cashPosting'
import { saleRowStatus, toBaseSale, type SaleDraftRow } from './rows'

export interface BulkSalesApi {
  addSaleBatch: (
    sales: Record<string, unknown>[],
    items: { productId: string; qty: number }[],
  ) => Promise<void>
  addDebt: (debt: Record<string, unknown>) => Promise<void>
  postMovement: (mv: {
    account: 'cash' | 'bank'
    direction: 'in' | 'out'
    amount: number
    category: string
    ref_table: string
    ref_id: string
    note: string | null
    created_at: string
  }) => Promise<void>
}

export interface BulkSalesResult {
  recorded: number
  debts: number
  failed: number
  failures: { product: string; error: string }[]
}

interface Built {
  row: SaleDraftRow
  product: Product
  groupId: string
  total: number
  sale: Record<string, unknown>
  item: { productId: string; qty: number }
}

export async function saveBulkSales(
  rows: SaleDraftRow[],
  products: Product[],
  api: BulkSalesApi,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkSalesResult> {
  const result: BulkSalesResult = { recorded: 0, debts: 0, failed: 0, failures: [] }
  const built: Built[] = []

  for (const row of rows) {
    const status = saleRowStatus(row, products)
    if (status.status !== 'ready') {
      result.failed++
      result.failures.push({ product: row.product || 'row', error: status.status })
      continue
    }
    const product = products.find((p) => p.id === row.productId)!
    const base = toBaseSale(row, product)
    const groupId = uid()
    const total = Math.round(base.unitPrice * base.quantity * 100) / 100
    built.push({
      row,
      product,
      groupId,
      total,
      sale: {
        id: uid(),
        product_id: product.id,
        product_name: product.name,
        quantity: base.quantity,
        unit_price: base.unitPrice,
        total,
        profit: Math.round((base.unitPrice - product.cost_price) * base.quantity * 100) / 100,
        customer_name: row.payment === 'credit' ? row.customer : null,
        customer_phone: null,
        payment_method: row.payment,
        sale_group_id: groupId,
        sale_unit: base.saleUnit,
        sale_unit_qty: base.saleUnitQty,
        created_at: row.date,
      },
      item: { productId: product.id, qty: base.quantity },
    })
  }

  if (built.length === 0) return result

  try {
    await api.addSaleBatch(built.map((b) => b.sale), built.map((b) => b.item))
    result.recorded = built.length
  } catch (e) {
    result.failed += built.length
    built.forEach((b) => result.failures.push({ product: b.product.name, error: e instanceof Error ? e.message : String(e) }))
    return result
  }

  // Ledger movements + credit debts, dated to each sale.
  for (let i = 0; i < built.length; i++) {
    const b = built[i]
    const mv = saleMovement(b.row.payment, b.total, 0)
    try {
      if (mv) {
        await api.postMovement({
          account: mv.account, direction: 'in', amount: mv.amount, category: 'sale',
          ref_table: 'sales', ref_id: b.groupId, note: b.row.customer || null, created_at: b.row.date,
        })
      }
      if (b.row.payment === 'credit') {
        const itemCount = b.item.qty
        await api.addDebt({
          id: uid(),
          person_name: b.row.customer,
          phone: null,
          amount: b.total,
          amount_paid: 0,
          payments: [],
          description: `${itemCount} ${itemCount === 1 ? 'item' : 'items'} on credit`,
          type: 'owed',
          due_date: null,
          injection_id: null,
          sale_group_id: b.groupId,
          is_paid: false,
          paid_at: null,
          created_at: b.row.date,
        })
        result.debts++
      }
    } catch {
      /* ledger/debt is best-effort; the sale itself is already recorded */
    }
    onProgress?.(i + 1, built.length)
  }

  return result
}
