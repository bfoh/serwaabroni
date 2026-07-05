import { describe, it, expect } from 'vitest'
import { shouldPostStockCash } from './batchApi'

describe('shouldPostStockCash', () => {
  it('posts cash for a normal paid purchase', () => {
    expect(shouldPostStockCash({ totalCost: 100 })).toBe(true)
  })
  it('does not post for supplier credit', () => {
    expect(shouldPostStockCash({ unpaid: true, totalCost: 100 })).toBe(false)
  })
  it('does not post for opening stock', () => {
    expect(shouldPostStockCash({ opening: true, totalCost: 100 })).toBe(false)
  })
  it('does not post when there is no cost', () => {
    expect(shouldPostStockCash({ totalCost: 0 })).toBe(false)
  })
})
