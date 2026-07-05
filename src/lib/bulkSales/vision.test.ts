import { describe, it, expect } from 'vitest'
import { normalizeSalesVisionRows } from './vision'

describe('normalizeSalesVisionRows', () => {
  it('coerces model output to SaleRawRow fields and drops junk', () => {
    const input = [
      { product: 'Milo', quantity: '2', unit_price: '3', payment: 'Cash', customer: 'Ama', date: '2026-07-03', unit: 'tin' },
      { quantity: 5 }, // no product → dropped
      'nonsense',
      null,
    ]
    expect(normalizeSalesVisionRows(input)).toEqual([
      { product: 'Milo', quantity: 2, unit_price: 3, payment: 'Cash', customer: 'Ama', date: '2026-07-03', unit: 'tin' },
    ])
  })
  it('returns [] for non-arrays', () => {
    expect(normalizeSalesVisionRows({})).toEqual([])
  })
})
