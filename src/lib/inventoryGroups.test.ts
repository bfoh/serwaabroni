import { describe, it, expect } from 'vitest'
import { groupByName, groupTotalLabel } from './inventoryGroups'
import type { Product } from '@/lib/supabase'

const p = (over: Partial<Product>): Product => ({
  id: 'x', user_id: 'u', name: 'Milo', cost_price: 10, selling_price: 20, quantity: 5,
  unit: 'tin', units_per_pack: 1, category: 'Beverages', low_stock_threshold: 5,
  created_at: '2026-06-06T00:00:00Z', ...over,
})

describe('groupByName', () => {
  it('groups same-named products (case/space-insensitive), keeping order', () => {
    const list = [
      p({ id: 'a', name: 'Test Milo 400g' }),
      p({ id: 'b', name: 'Dell' }),
      p({ id: 'c', name: ' test milo 400g ' }),
    ]
    const groups = groupByName(list)
    expect(groups.map((g) => g.products.map((x) => x.id))).toEqual([['a', 'c'], ['b']])
    expect(groups[0].name).toBe('Test Milo 400g') // first-seen original casing
    expect(groups[0].key).toBe('test milo 400g')
  })
})

describe('groupTotalLabel', () => {
  it('sums quantity with the shared unit', () => {
    expect(groupTotalLabel([p({ quantity: 70, unit: 'tin' }), p({ quantity: 11, unit: 'tin' })])).toBe('81 tin')
  })
  it('falls back to entry count when units differ', () => {
    expect(groupTotalLabel([p({ quantity: 70, unit: 'tin' }), p({ quantity: 11, unit: 'box' })])).toBe('2 stock entries')
  })
})
