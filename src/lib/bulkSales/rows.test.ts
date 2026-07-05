import { describe, it, expect } from 'vitest'
import { rowsFromMatrix, normalizeSaleRow, matchSaleRow, toBaseSale, saleRowStatus } from './rows'
import type { Product } from '@/lib/supabase'

const prod = (over: Partial<Product>): Product => ({
  id: 'p', user_id: 'u', name: 'Indomie', cost_price: 2, selling_price: 3, quantity: 50,
  unit: 'sachet', pack_unit: 'box', units_per_pack: 40, category: 'Noodles',
  low_stock_threshold: 5, created_at: '2026-07-01T00:00:00Z', ...over,
})

describe('rowsFromMatrix', () => {
  it('maps sales headers to RawRow fields', () => {
    const matrix = [
      ['Product', 'Quantity', 'Payment', 'Date'],
      ['Milo', '3', 'credit', '2026-07-03'],
    ]
    expect(rowsFromMatrix(matrix)).toEqual([
      { product: 'Milo', quantity: 3, payment: 'credit', date: '2026-07-03' },
    ])
  })
})

describe('normalizeSaleRow', () => {
  it('defaults payment to cash and date to today when blank', () => {
    const r = normalizeSaleRow({ product: 'Milo', quantity: 3 })
    expect(r.payment).toBe('cash')
    expect(r.unitPrice).toBeNull()
    expect(new Date(r.date).toString()).not.toBe('Invalid Date')
    expect(r.id).toBeTruthy()
  })
  it('keeps a valid date and known payment', () => {
    const r = normalizeSaleRow({ product: 'Milo', quantity: 3, payment: 'MoMo', date: '2026-07-03', unit_price: 5 })
    expect(r.payment).toBe('momo')
    expect(r.date.startsWith('2026-07-03')).toBe(true)
    expect(r.unitPrice).toBe(5)
  })
})

describe('matchSaleRow', () => {
  it('resolves productId by fuzzy name', () => {
    const products = [prod({ id: 'indomie', name: 'Indomie' })]
    const r = matchSaleRow(normalizeSaleRow({ product: 'indomie', quantity: 2 }), products)
    expect(r.productId).toBe('indomie')
  })
  it('leaves productId null when no match', () => {
    const r = matchSaleRow(normalizeSaleRow({ product: 'ZZZ', quantity: 2 }), [prod({})])
    expect(r.productId).toBeNull()
  })
})

describe('toBaseSale', () => {
  it('converts a pack sale (unit = product pack unit) to base', () => {
    const p = prod({ id: 'indomie', name: 'Indomie', pack_unit: 'box', units_per_pack: 40, selling_price: 3 })
    const row = matchSaleRow(normalizeSaleRow({ product: 'Indomie', quantity: 2, unit: 'box', unit_price: 120 }), [p])
    expect(toBaseSale(row, p)).toEqual({ quantity: 80, unitPrice: 3, saleUnit: 'box', saleUnitQty: 2 })
  })
  it('base sale uses product price when unit price blank', () => {
    const p = prod({ id: 'indomie', name: 'Indomie', pack_unit: null, units_per_pack: 1, selling_price: 3 })
    const row = matchSaleRow(normalizeSaleRow({ product: 'Indomie', quantity: 5 }), [p])
    expect(toBaseSale(row, p)).toEqual({ quantity: 5, unitPrice: 3, saleUnit: null, saleUnitQty: null })
  })
})

describe('saleRowStatus', () => {
  const products = [prod({ id: 'indomie', name: 'Indomie', quantity: 4, pack_unit: null, units_per_pack: 1 })]
  it('flags unmatched', () => {
    const r = matchSaleRow(normalizeSaleRow({ product: 'ZZZ', quantity: 2 }), products)
    expect(saleRowStatus(r, products).status).toBe('unmatched')
  })
  it('flags invalid when credit has no customer', () => {
    const r = matchSaleRow(normalizeSaleRow({ product: 'Indomie', quantity: 2, payment: 'credit' }), products)
    const s = saleRowStatus(r, products)
    expect(s.status).toBe('invalid')
    expect(s.errors).toContain('customer')
  })
  it('warns when quantity exceeds current stock but stays ready', () => {
    const r = matchSaleRow(normalizeSaleRow({ product: 'Indomie', quantity: 10 }), products)
    const s = saleRowStatus(r, products)
    expect(s.status).toBe('ready')
    expect(s.warnings).toContain('stock')
  })
})
