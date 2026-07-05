import type { Product } from '@/lib/supabase'
import { uid } from '@/lib/data'
import { rowStatus, toBase, type DraftRow } from './rows'

export type CashMode =
  | { kind: 'opening' }
  | { kind: 'purchase'; account: 'cash' | 'bank' }
  | { kind: 'supplier_credit'; supplierName: string; supplierPhone: string | null }

export interface BulkSaveApi {
  addProduct: (
    product: Record<string, unknown>,
    injectionId: string | null,
    opts: { account?: 'cash' | 'bank'; unpaid?: boolean; opening?: boolean },
  ) => Promise<void>
  updateProduct: (id: string, updates: Record<string, unknown>) => Promise<void>
  receiveStock: (params: {
    productId: string
    qty: number
    unitCost: number
    account?: 'cash' | 'bank'
    unpaid?: boolean
    opening?: boolean
  }) => Promise<unknown>
  addDebt: (debt: Record<string, unknown>) => Promise<void>
  findQty: (id: string) => number
}

export interface BulkSaveResult {
  added: number
  restocked: number
  failed: number
  failures: { name: string; error: string }[]
}

function cashOpts(mode: CashMode): { account?: 'cash' | 'bank'; unpaid?: boolean; opening?: boolean } {
  if (mode.kind === 'opening') return { opening: true }
  if (mode.kind === 'purchase') return { account: mode.account }
  return { unpaid: true }
}

export async function saveBulkRows(
  rows: DraftRow[],
  products: Product[],
  mode: CashMode,
  api: BulkSaveApi,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkSaveResult> {
  const opts = cashOpts(mode)
  const result: BulkSaveResult = { added: 0, restocked: 0, failed: 0, failures: [] }
  let supplierTotal = 0
  const total = rows.length

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const status = rowStatus(row, products)
    const base = toBase(row)
    try {
      if (status.status === 'invalid') throw new Error('invalid row')
      if (status.status === 'new') {
        const nowIso = new Date().toISOString()
        await api.addProduct(
          {
            id: uid(),
            name: row.name,
            cost_price: base.costPrice,
            selling_price: base.sellPrice,
            quantity: base.quantity,
            unit: row.unit,
            pack_unit: base.packUnit,
            units_per_pack: base.unitsPerPack,
            category: row.category,
            low_stock_threshold: row.lowStockThreshold ?? Math.max(3, Math.floor(base.quantity * 0.2)),
            barcode: null,
            qr_code: null,
            created_at: nowIso,
          },
          null,
          opts,
        )
        result.added++
      } else {
        const id = status.matchId as string
        await api.updateProduct(id, { quantity: api.findQty(id) + base.quantity })
        await api.receiveStock({ productId: id, qty: base.quantity, unitCost: base.costPrice, ...opts })
        result.restocked++
      }
      supplierTotal += Math.round(base.costPrice * base.quantity * 100) / 100
    } catch (e) {
      result.failed++
      result.failures.push({ name: row.name || 'row', error: e instanceof Error ? e.message : String(e) })
    }
    onProgress?.(i + 1, total)
  }

  if (mode.kind === 'supplier_credit' && supplierTotal > 0) {
    await api.addDebt({
      id: uid(),
      person_name: mode.supplierName,
      phone: mode.supplierPhone,
      amount: Math.round(supplierTotal * 100) / 100,
      amount_paid: 0,
      payments: [],
      description: `Bulk stock (${result.added + result.restocked} items)`,
      type: 'owing',
      due_date: null,
      injection_id: null,
      sale_group_id: null,
      is_paid: false,
      paid_at: null,
      created_at: new Date().toISOString(),
    })
  }

  return result
}
