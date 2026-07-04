import { describe, it, expect } from 'vitest'
import { buildSnapshot } from './snapshot'
import type { Product, Debt } from '@/lib/supabase'

const p = (over: Partial<Product>): Product => ({
  id: 'p1', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3,
  quantity: 10, unit: 'sachet', units_per_pack: 1, category: 'food',
  low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z', ...over,
})
const d = (over: Partial<Debt>): Debt => ({
  id: 'd1', user_id: 'u', person_name: 'Ama', phone: null, amount: 100,
  amount_paid: 0, payments: [], description: null, type: 'owed', due_date: null,
  is_paid: false, paid_at: null, created_at: '2026-07-01T00:00:00Z', ...over,
})

describe('buildSnapshot', () => {
  it('summarises products, low stock, and debts', () => {
    const snap = buildSnapshot({
      products: [
        p({ id: 'a', name: 'Indomie', quantity: 10, selling_price: 3 }),
        p({ id: 'b', name: 'Milo', quantity: 2, low_stock_threshold: 5, selling_price: 8 }),
      ],
      debts: [
        d({ type: 'owed', amount: 100, is_paid: false }),
        d({ type: 'owing', amount: 40, is_paid: false }),
        d({ type: 'owed', amount: 999, is_paid: true }),
      ],
      todaySales: 500, todayProfit: 120, cashInHand: 300, cashInBank: 700,
    })
    expect(snap.currency).toBe('GHS')
    expect(snap.products).toHaveLength(2)
    expect(snap.products[0]).toEqual({ id: 'a', name: 'Indomie', qty: 10, unit: 'sachet', price: 3 })
    expect(snap.lowStock).toEqual([{ name: 'Milo', qty: 2 }])
    expect(snap.owedTotal).toBe(100)   // excludes paid
    expect(snap.owingTotal).toBe(40)
    expect(snap.todaySales).toBe(500)
  })

  it('caps the product list to 80 items to bound tokens', () => {
    const many: Product[] = Array.from({ length: 200 }, (_, i) => p({ id: `p${i}`, name: `Item ${i}` }))
    const snap = buildSnapshot({ products: many, debts: [], todaySales: 0, todayProfit: 0, cashInHand: 0, cashInBank: 0 })
    expect(snap.products.length).toBe(80)
  })
})
