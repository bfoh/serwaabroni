import { describe, it, expect } from 'vitest'
import {
  isMultiUnit, factorOf, toBase, splitStock,
  priceFor, costFor, formatStock, saleDisplay,
} from './units'

const indomie = {
  quantity: 95, unit: 'sachet', pack_unit: 'box', units_per_pack: 10,
  cost_price: 2.5, selling_price: 3,
}
const single = {
  quantity: 7, unit: 'pack', pack_unit: null, units_per_pack: 1,
  cost_price: 10, selling_price: 14,
}

describe('isMultiUnit / factorOf', () => {
  it('detects multi-unit', () => {
    expect(isMultiUnit(indomie)).toBe(true)
    expect(isMultiUnit(single)).toBe(false)
    expect(isMultiUnit({ pack_unit: 'box', units_per_pack: 1 })).toBe(false)
  })
  it('clamps a bad factor to 1', () => {
    expect(factorOf({ units_per_pack: 0 })).toBe(1)
    expect(factorOf({ units_per_pack: 2.5 })).toBe(1)
    expect(factorOf({ units_per_pack: 10 })).toBe(10)
  })
})

describe('toBase', () => {
  it('multiplies packs, passes base through', () => {
    expect(toBase(10, 'pack', indomie)).toBe(100)
    expect(toBase(4, 'base', indomie)).toBe(4)
    expect(toBase(3, 'pack', single)).toBe(3) // factor 1
  })
})

describe('splitStock', () => {
  it('splits whole packs and loose', () => {
    expect(splitStock(95, 10)).toEqual({ packs: 9, loose: 5 })
    expect(splitStock(100, 10)).toEqual({ packs: 10, loose: 0 })
    expect(splitStock(7, 10)).toEqual({ packs: 0, loose: 7 })
    expect(splitStock(0, 10)).toEqual({ packs: 0, loose: 0 })
  })
  it('treats bad factor as 1', () => {
    expect(splitStock(5, 0)).toEqual({ packs: 5, loose: 0 })
  })
})

describe('priceFor / costFor', () => {
  it('derives pack from base', () => {
    expect(priceFor(indomie, 'pack')).toBe(30)
    expect(priceFor(indomie, 'base')).toBe(3)
    expect(costFor(indomie, 'pack')).toBe(25)
    expect(costFor(single, 'pack')).toBe(10) // factor 1
  })
})

describe('formatStock', () => {
  it('mixes packs and loose for multi-unit', () => {
    expect(formatStock(indomie)).toBe('9 box 5 sachet (95 sachet)')
  })
  it('shows only packs when no loose', () => {
    expect(formatStock({ ...indomie, quantity: 100 })).toBe('10 box (100 sachet)')
  })
  it('shows only loose when under one pack', () => {
    expect(formatStock({ ...indomie, quantity: 7 })).toBe('7 sachet (7 sachet)')
  })
  it('shows plain count for single-unit', () => {
    expect(formatStock(single)).toBe('7 pack')
  })
})

describe('saleDisplay', () => {
  it('uses sale_unit when present', () => {
    const d = saleDisplay({ quantity: 20, unit_price: 3, total: 60, sale_unit: 'box', sale_unit_qty: 2 })
    expect(d.qtyLabel).toBe('2 box')
    expect(d.unitPrice).toBe(30)
  })
  it('falls back to base quantity', () => {
    const d = saleDisplay({ quantity: 4, unit_price: 3, total: 12, sale_unit: null, sale_unit_qty: null })
    expect(d.qtyLabel).toBe('4')
    expect(d.unitPrice).toBe(3)
  })
})
