import { describe, it, expect, vi } from 'vitest'
import { saveBulkRows, type CashMode } from './save'
import { normalizeRow } from './rows'
import type { Product } from '@/lib/supabase'

const products: Product[] = [{
  id: 'indomie', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 10,
  unit: 'piece', units_per_pack: 1, category: 'Noodles', low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z',
}]

function fakeApi() {
  return {
    addProduct: vi.fn().mockResolvedValue(undefined),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    receiveStock: vi.fn().mockResolvedValue(undefined),
    addDebt: vi.fn().mockResolvedValue(undefined),
    findQty: vi.fn().mockReturnValue(10),
  }
}

const newRow = normalizeRow({ name: 'Rice 5kg', cost_price: 40, selling_price: 55, quantity: 3 })
const restockRow = normalizeRow({ name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 24 })

describe('saveBulkRows', () => {
  it('opening mode: new via addProduct(opening), restock via updateProduct+receiveStock(opening), no debt/cash', async () => {
    const api = fakeApi()
    const res = await saveBulkRows([newRow, restockRow], products, { kind: 'opening' }, api)
    expect(res).toMatchObject({ added: 1, restocked: 1, failed: 0 })
    expect(api.addProduct.mock.calls[0][2]).toEqual({ opening: true })
    expect(api.updateProduct).toHaveBeenCalledWith('indomie', { quantity: 34 }) // 10 + 24
    expect(api.receiveStock.mock.calls[0][0]).toMatchObject({ productId: 'indomie', qty: 24, unitCost: 2, opening: true })
    expect(api.addDebt).not.toHaveBeenCalled()
  })

  it('purchase paid: passes the account and posts no debt', async () => {
    const api = fakeApi()
    const mode: CashMode = { kind: 'purchase', account: 'bank', injectionId: null }
    await saveBulkRows([newRow], products, mode, api)
    expect(api.addProduct.mock.calls[0][2]).toEqual({ account: 'bank' })
    expect(api.addDebt).not.toHaveBeenCalled()
  })

  it('purchase funded by capital: threads injectionId to addProduct and receiveStock', async () => {
    const api = fakeApi()
    const mode: CashMode = { kind: 'purchase', account: 'cash', injectionId: 'inj-1' }
    await saveBulkRows([newRow, restockRow], products, mode, api)
    expect(api.addProduct.mock.calls[0][1]).toBe('inj-1')
    expect(api.receiveStock.mock.calls[0][0]).toMatchObject({ injectionId: 'inj-1' })
  })

  it('supplier credit: unpaid opts + one owing debt per item', async () => {
    const api = fakeApi()
    const mode: CashMode = { kind: 'supplier_credit', supplierName: 'Ali', supplierPhone: null }
    await saveBulkRows([newRow, restockRow], products, mode, api)
    expect(api.addProduct.mock.calls[0][2]).toEqual({ unpaid: true })
    expect(api.addDebt).toHaveBeenCalledTimes(2) // one per item
    const amounts = api.addDebt.mock.calls.map((c) => (c[0] as { amount: number }).amount).sort((a, b) => a - b)
    expect(amounts).toEqual([2 * 24, 40 * 3]) // Indomie restock, Rice new
    const debt = api.addDebt.mock.calls[0][0]
    expect(debt).toMatchObject({ person_name: 'Ali', type: 'owing' })
    expect((debt as { description: string }).description).toContain('Stock: ')
  })

  it('reports per-row failures without aborting', async () => {
    const api = fakeApi()
    api.addProduct.mockRejectedValueOnce(new Error('boom'))
    const res = await saveBulkRows([newRow, restockRow], products, { kind: 'opening' }, api)
    expect(res.failed).toBe(1)
    expect(res.restocked).toBe(1)
    expect(res.failures[0].name).toBe('Rice 5kg')
  })

  it('converts a packed new row to base before saving', async () => {
    const api = fakeApi()
    const packRow = normalizeRow({
      name: 'Spaghetti', quantity: 5, cost_price: 100, selling_price: 120,
      unit: 'sachet', pack_unit: 'box', units_per_pack: 40,
    })
    await saveBulkRows([packRow], products, { kind: 'opening' }, api)
    const product = api.addProduct.mock.calls[0][0]
    expect(product).toMatchObject({ quantity: 200, cost_price: 2.5, selling_price: 3, units_per_pack: 40, pack_unit: 'box' })
  })
})
