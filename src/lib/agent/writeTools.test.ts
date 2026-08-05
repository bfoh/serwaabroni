import { describe, it, expect } from 'vitest'
import { buildPreview } from './writeTools'
import type { Product } from '@/lib/supabase'

const mk = (name: string, over: Partial<Product> = {}): Product => ({
  id: name, user_id: 'u', name, cost_price: 2, selling_price: 3, quantity: 20,
  unit: 'pc', units_per_pack: 1, category: 'food', low_stock_threshold: 5,
  created_at: '2026-07-01T00:00:00Z', ...over,
})

const ctx = { products: [mk('Indomie'), mk('Milo', { cost_price: 4, selling_price: 8 }), mk('Mackerel 7 Gh'), mk('Mackerel 15 Gh')] }

describe('buildPreview', () => {
  it('builds a cash sale preview with resolved prices and profit', () => {
    const r = buildPreview({ name: 'add_sale', input: { items: [{ product: 'indomie', qty: 5 }], payment: 'cash' } }, ctx)
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('sale')
    expect(r.sale?.items[0]).toMatchObject({ productName: 'Indomie', qty: 5, unitPrice: 3, unitCost: 2 })
    expect(r.sale?.payment).toBe('cash')
    // total line present
    expect(r.lines.some((l) => l.value.includes('15'))).toBe(true) // 5 * 3 = 15
  })

  it('errors on ambiguous product', () => {
    const r = buildPreview({ name: 'add_sale', input: { items: [{ product: 'mackerel', qty: 1 }], payment: 'cash' } }, ctx)
    expect('error' in r).toBe(true)
  })

  it('sells in the bigger pack unit when the buyer names it', () => {
    const packCtx = { products: [mk('Indomie', { pack_unit: 'box', units_per_pack: 40, selling_price: 3, cost_price: 2 })] }
    const r = buildPreview({ name: 'add_sale', input: { items: [{ product: 'indomie', qty: 2, unit: 'box' }], payment: 'cash' } }, packCtx)
    if ('error' in r) throw new Error(r.error)
    // 2 boxes × 40 = 80 base units; price stays per base
    expect(r.sale?.items[0]).toMatchObject({ qty: 80, unitPrice: 3, saleUnit: 'box', saleUnitQty: 2 })
    expect(r.lines.some((l) => l.label.includes('×2 box'))).toBe(true)
    expect(r.lines.some((l) => l.value.includes('240'))).toBe(true) // 80 × 3
  })

  it('sells the small unit when no pack unit is named', () => {
    const packCtx = { products: [mk('Indomie', { pack_unit: 'box', units_per_pack: 40, selling_price: 3 })] }
    const r = buildPreview({ name: 'add_sale', input: { items: [{ product: 'indomie', qty: 5 }], payment: 'cash' } }, packCtx)
    if ('error' in r) throw new Error(r.error)
    expect(r.sale?.items[0]).toMatchObject({ qty: 5, saleUnit: null, saleUnitQty: null })
  })

  it('builds a credit sale preview', () => {
    const r = buildPreview(
      { name: 'add_credit_sale', input: { items: [{ product: 'milo', qty: 2 }], customer_name: 'Ama' } },
      ctx,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('credit_sale')
    expect(r.credit?.customerName).toBe('Ama')
    expect(r.credit?.items[0].qty).toBe(2)
  })

  it('builds a new_product preview', () => {
    const r = buildPreview(
      { name: 'new_product', input: { name: 'Rice 5kg', cost_price: 40, sell_price: 55, qty: 10 } },
      ctx,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('new_product')
    expect(r.newProduct).toMatchObject({ name: 'Rice 5kg', costPrice: 40, sellPrice: 55, qty: 10, payment: 'cash' })
  })

  it('defaults category to Uncategorized when not provided', () => {
    const r = buildPreview(
      { name: 'new_product', input: { name: 'Rice 5kg', cost_price: 40, sell_price: 55, qty: 10 } },
      ctx,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.newProduct?.category).toBe('Uncategorized')
  })

  it('builds an add_stock preview against an existing product', () => {
    const r = buildPreview({ name: 'add_stock', input: { product: 'indomie', qty: 24 } }, ctx)
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('add_stock')
    expect(r.addStock).toMatchObject({ productName: 'Indomie', qty: 24, unitCost: 2 })
  })

  it('builds a new_product preview with qty 0', () => {
    const r = buildPreview(
      { name: 'new_product', input: { name: 'Rice 5kg', cost_price: 40, sell_price: 55, qty: 0 } },
      ctx,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.kind).toBe('new_product')
    expect(r.newProduct?.qty).toBe(0)
  })
})
