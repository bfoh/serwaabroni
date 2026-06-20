import { describe, it, expect } from 'vitest'
import { saleMovement } from './cashPosting'

describe('saleMovement', () => {
  it('cash sale → full total to cash', () => {
    expect(saleMovement('cash', 50, 0)).toEqual({ account: 'cash', amount: 50 })
  })
  it('momo sale → full total to bank', () => {
    expect(saleMovement('momo', 50, 0)).toEqual({ account: 'bank', amount: 50 })
  })
  it('bank sale → full total to bank', () => {
    expect(saleMovement('bank', 80, 0)).toEqual({ account: 'bank', amount: 80 })
  })
  it('credit sale → only the deposit to cash', () => {
    expect(saleMovement('credit', 100, 20)).toEqual({ account: 'cash', amount: 20 })
  })
  it('credit sale with no deposit → no movement', () => {
    expect(saleMovement('credit', 100, 0)).toBeNull()
  })
})
