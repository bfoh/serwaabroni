import { describe, it, expect, vi } from 'vitest'
import { saveBulkSales } from './save'
import { normalizeSaleRow, matchSaleRow } from './rows'
import type { Product } from '@/lib/supabase'

const products: Product[] = [{
  id: 'indomie', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 100,
  unit: 'sachet', pack_unit: null, units_per_pack: 1, category: 'Noodles',
  low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z',
}]

function fakeApi() {
  return {
    addSaleBatch: vi.fn().mockResolvedValue(undefined),
    addDebt: vi.fn().mockResolvedValue(undefined),
    postMovement: vi.fn().mockResolvedValue(undefined),
  }
}
const mk = (over: Parameters<typeof normalizeSaleRow>[0]) => matchSaleRow(normalizeSaleRow(over), products)

describe('saveBulkSales', () => {
  it('records a cash sale, posts a ledger movement, no debt', async () => {
    const api = fakeApi()
    const row = mk({ product: 'Indomie', quantity: 5, payment: 'cash', date: '2026-07-03' })
    const res = await saveBulkSales([row], products, api)
    expect(res).toMatchObject({ recorded: 1, debts: 0, failed: 0 })
    const [sales, items] = api.addSaleBatch.mock.calls[0]
    expect(sales[0]).toMatchObject({ product_id: 'indomie', quantity: 5, unit_price: 3, total: 15, profit: 5, payment_method: 'cash' })
    expect(sales[0].created_at.startsWith('2026-07-03')).toBe(true)
    expect(items).toEqual([{ productId: 'indomie', qty: 5 }])
    expect(api.postMovement.mock.calls[0][0]).toMatchObject({ account: 'cash', direction: 'in', amount: 15, category: 'sale', ref_id: sales[0].sale_group_id, created_at: sales[0].created_at })
    expect(api.addDebt).not.toHaveBeenCalled()
  })

  it('records a credit sale and creates a linked owed debt, no movement', async () => {
    const api = fakeApi()
    const row = mk({ product: 'Indomie', quantity: 4, payment: 'credit', customer: 'Ama', date: '2026-07-03' })
    const res = await saveBulkSales([row], products, api)
    expect(res).toMatchObject({ recorded: 1, debts: 1 })
    const [sales] = api.addSaleBatch.mock.calls[0]
    expect(sales[0].payment_method).toBe('credit')
    expect(api.postMovement).not.toHaveBeenCalled()
    const debt = api.addDebt.mock.calls[0][0]
    expect(debt).toMatchObject({ person_name: 'Ama', amount: 12, type: 'owed', sale_group_id: sales[0].sale_group_id })
  })

  it('momo posts to the bank account', async () => {
    const api = fakeApi()
    const row = mk({ product: 'Indomie', quantity: 2, payment: 'momo' })
    await saveBulkSales([row], products, api)
    expect(api.postMovement.mock.calls[0][0]).toMatchObject({ account: 'bank', amount: 6 })
  })

  it('skips unmatched/invalid rows', async () => {
    const api = fakeApi()
    const bad = mk({ product: 'ZZZ', quantity: 2 }) // unmatched
    const res = await saveBulkSales([bad], products, api)
    expect(res.recorded).toBe(0)
    expect(api.addSaleBatch).not.toHaveBeenCalled()
  })
})
