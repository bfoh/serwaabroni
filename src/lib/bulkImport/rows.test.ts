import { describe, it, expect } from 'vitest'
import { rowsFromMatrix, normalizeRow, rowStatus, toBase } from './rows'
import type { Product } from '@/lib/supabase'

const prod = (name: string, id = name): Product => ({
  id, user_id: 'u', name, cost_price: 1, selling_price: 2, quantity: 4,
  unit: 'piece', units_per_pack: 1, category: 'Groceries', low_stock_threshold: 5,
  created_at: '2026-07-01T00:00:00Z',
})

describe('rowsFromMatrix', () => {
  it('maps headers (any case/order) to RawRow fields', () => {
    const matrix = [
      ['Name', 'Cost Price', 'Selling Price', 'Quantity'],
      ['Milo', '4', '8', '10'],
    ]
    expect(rowsFromMatrix(matrix)).toEqual([
      { name: 'Milo', cost_price: 4, selling_price: 8, quantity: 10 },
    ])
  })
})

describe('normalizeRow', () => {
  it('applies defaults', () => {
    const r = normalizeRow({ name: 'Milo', cost_price: 4, selling_price: 8, quantity: 10 })
    expect(r).toMatchObject({ name: 'Milo', unit: 'piece', category: 'Uncategorized', unitsPerPack: 1 })
    expect(r.id).toBeTruthy()
  })
})

describe('rowStatus', () => {
  const products = [prod('Indomie'), prod('Milo')]
  it('flags invalid when cost is missing/zero', () => {
    const r = normalizeRow({ name: 'Rice', cost_price: 0, selling_price: 5, quantity: 2 })
    expect(rowStatus(r, products).status).toBe('invalid')
  })
  it('marks a matched name as restock', () => {
    const r = normalizeRow({ name: 'indomie', cost_price: 2, selling_price: 3, quantity: 5 })
    const s = rowStatus(r, products)
    expect(s.status).toBe('restock')
    expect(s.matchId).toBe('Indomie')
  })
  it('marks an unmatched valid row as new', () => {
    const r = normalizeRow({ name: 'Rice 5kg', cost_price: 40, selling_price: 55, quantity: 3 })
    expect(rowStatus(r, products).status).toBe('new')
  })
})

describe('toBase', () => {
  it('converts per-pack quantity and prices to base', () => {
    const r = normalizeRow({
      name: 'Indomie', quantity: 5, cost_price: 100, selling_price: 120,
      unit: 'sachet', pack_unit: 'box', units_per_pack: 40,
    })
    expect(toBase(r)).toEqual({ quantity: 200, costPrice: 2.5, sellPrice: 3, unitsPerPack: 40, packUnit: 'box' })
  })
  it('passes through a per-piece row unchanged (factor 1, no pack)', () => {
    const r = normalizeRow({ name: 'Milo', quantity: 12, cost_price: 4, selling_price: 8, unit: 'tin' })
    expect(toBase(r)).toEqual({ quantity: 12, costPrice: 4, sellPrice: 8, unitsPerPack: 1, packUnit: null })
  })
})
