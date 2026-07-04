import { describe, it, expect } from 'vitest'
import { matchProduct } from './match'
import type { Product } from '@/lib/supabase'

const mk = (name: string, id = name): Product => ({
  id, user_id: 'u', name, cost_price: 1, selling_price: 2, quantity: 5,
  unit: 'pc', units_per_pack: 1, category: 'x', low_stock_threshold: 5,
  created_at: '2026-07-01T00:00:00Z',
})

const products = [mk('Indomie'), mk('Milo'), mk('Mackerel 7 Gh', 'm7'), mk('Mackerel 15 Gh', 'm15')]

describe('matchProduct', () => {
  it('matches exact name case-insensitively', () => {
    const r = matchProduct('indomie', products)
    expect(r.product?.name).toBe('Indomie')
    expect(r.ambiguous).toBe(false)
  })

  it('matches unique substring', () => {
    const r = matchProduct('milo', products)
    expect(r.product?.name).toBe('Milo')
  })

  it('flags ambiguous when multiple tie', () => {
    const r = matchProduct('mackerel', products)
    expect(r.product).toBeNull()
    expect(r.ambiguous).toBe(true)
    expect(r.candidates.map((c) => c.name).sort()).toEqual(['Mackerel 15 Gh', 'Mackerel 7 Gh'])
  })

  it('returns no match for unknown', () => {
    const r = matchProduct('zzz', products)
    expect(r.product).toBeNull()
    expect(r.ambiguous).toBe(false)
    expect(r.candidates).toEqual([])
  })
})
