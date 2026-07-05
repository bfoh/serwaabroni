import { describe, it, expect } from 'vitest'
import { normalizeVisionRows } from './vision'

describe('normalizeVisionRows', () => {
  it('coerces model output to RawRow fields and drops junk', () => {
    const input = [
      { name: 'Milo', quantity: '10', cost_price: '4', selling_price: 8, unit: 'tin' },
      { name: 42 },
      'nonsense',
      null,
    ]
    expect(normalizeVisionRows(input)).toEqual([
      { name: 'Milo', quantity: 10, cost_price: 4, selling_price: 8, unit: 'tin' },
    ])
  })
  it('returns [] for non-arrays', () => {
    expect(normalizeVisionRows({})).toEqual([])
    expect(normalizeVisionRows(null)).toEqual([])
  })
})
