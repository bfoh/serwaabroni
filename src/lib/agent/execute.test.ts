import { describe, it, expect, vi } from 'vitest'
import { executePreview } from './execute'
import type { ConfirmPreview } from './types'

function fakeApi() {
  return {
    addSaleBatch: vi.fn().mockResolvedValue(undefined),
    addDebt: vi.fn().mockResolvedValue(undefined),
    addProduct: vi.fn().mockResolvedValue(undefined),
    updateProduct: vi.fn().mockResolvedValue(undefined),
    findProductQty: vi.fn().mockReturnValue(20),
  }
}

describe('executePreview', () => {
  it('writes a cash sale via addSaleBatch with matching items', async () => {
    const api = fakeApi()
    const preview: ConfirmPreview = {
      kind: 'sale', title: '', lines: [], warnings: [],
      sale: { payment: 'cash', items: [{ productId: 'p1', productName: 'Indomie', unitPrice: 3, unitCost: 2, qty: 5 }] },
    }
    await executePreview(preview, api)
    expect(api.addSaleBatch).toHaveBeenCalledTimes(1)
    const [sales, items] = api.addSaleBatch.mock.calls[0]
    expect(items).toEqual([{ productId: 'p1', qty: 5 }])
    expect(sales[0]).toMatchObject({ product_id: 'p1', quantity: 5, total: 15, profit: 5, payment_method: 'cash' })
    expect(sales[0].sale_group_id).toBeTruthy()
    expect(api.addDebt).not.toHaveBeenCalled()
  })

  it('writes a credit sale plus a linked debt', async () => {
    const api = fakeApi()
    const preview: ConfirmPreview = {
      kind: 'credit_sale', title: '', lines: [], warnings: [],
      credit: { customerName: 'Ama', dueDate: null, items: [{ productId: 'p2', productName: 'Milo', unitPrice: 8, unitCost: 4, qty: 2 }] },
    }
    await executePreview(preview, api)
    expect(api.addSaleBatch).toHaveBeenCalledTimes(1)
    const [sales] = api.addSaleBatch.mock.calls[0]
    expect(sales[0].payment_method).toBe('credit')
    expect(api.addDebt).toHaveBeenCalledTimes(1)
    const debt = api.addDebt.mock.calls[0][0]
    expect(debt).toMatchObject({ person_name: 'Ama', amount: 16, type: 'owed' })
    expect(debt.sale_group_id).toBe(sales[0].sale_group_id)
  })

  it('creates a new product with the chosen payment account', async () => {
    const api = fakeApi()
    const preview: ConfirmPreview = {
      kind: 'new_product', title: '', lines: [], warnings: [],
      newProduct: { name: 'Rice', costPrice: 40, sellPrice: 55, qty: 10, category: 'food', payment: 'supplier_credit' },
    }
    await executePreview(preview, api)
    expect(api.addProduct).toHaveBeenCalledTimes(1)
    const [product, injectionId, opts] = api.addProduct.mock.calls[0]
    expect(product).toMatchObject({ name: 'Rice', cost_price: 40, selling_price: 55, quantity: 10 })
    expect(injectionId).toBeNull()
    expect(opts).toEqual({ account: 'cash', unpaid: true })
  })

  it('adds stock to an existing product', async () => {
    const api = fakeApi()
    const preview: ConfirmPreview = {
      kind: 'add_stock', title: '', lines: [], warnings: [],
      addStock: { productId: 'p1', productName: 'Indomie', qty: 24, unitCost: 2 },
    }
    await executePreview(preview, api)
    expect(api.updateProduct).toHaveBeenCalledWith('p1', { quantity: 44 }) // 20 + 24
  })
})
