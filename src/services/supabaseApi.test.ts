import { describe, it, expect } from 'vitest'
import { maskCostPriceForRole } from './supabaseApi'
import type { Product } from '@/lib/supabase'

const product = (over: Partial<Product> = {}): Product => ({
  id: 'p1', user_id: 'u1', name: 'Rice', cost_price: 50, selling_price: 80,
  quantity: 10, unit: 'bag', units_per_pack: 1, category: 'Groceries',
  low_stock_threshold: 5, created_at: '2026-08-01T00:00:00.000Z', ...over,
})

describe('maskCostPriceForRole', () => {
  it('leaves cost_price intact for owner, manager, and unresolved role', () => {
    expect(maskCostPriceForRole([product()], 'owner')[0].cost_price).toBe(50)
    expect(maskCostPriceForRole([product()], 'manager')[0].cost_price).toBe(50)
    expect(maskCostPriceForRole([product()], null)[0].cost_price).toBe(50)
  })
  it('zeroes cost_price for staff without dropping the field', () => {
    const [masked] = maskCostPriceForRole([product()], 'staff')
    expect(masked.cost_price).toBe(0)
    expect(masked.selling_price).toBe(80)
  })
})
