import { describe, it, expect } from 'vitest'
import { computeBalances } from './cashBalances'

describe('computeBalances', () => {
  it('returns 0/0 for no rows', () => {
    expect(computeBalances([])).toEqual({ cash: 0, bank: 0 })
  })
  it('nets cash in minus cash out', () => {
    const out = computeBalances([
      { account: 'cash', direction: 'in', amount: 100 },
      { account: 'cash', direction: 'out', amount: 30 },
    ])
    expect(out).toEqual({ cash: 70, bank: 0 })
  })
  it('nets bank separately', () => {
    const out = computeBalances([
      { account: 'bank', direction: 'in', amount: 200 },
      { account: 'bank', direction: 'out', amount: 50 },
      { account: 'cash', direction: 'in', amount: 10 },
    ])
    expect(out).toEqual({ cash: 10, bank: 150 })
  })
  it('a transfer (cash out + bank in) leaves total unchanged', () => {
    const out = computeBalances([
      { account: 'cash', direction: 'in', amount: 100 },
      { account: 'cash', direction: 'out', amount: 40 }, // deposit leg
      { account: 'bank', direction: 'in', amount: 40 },  // deposit leg
    ])
    expect(out.cash + out.bank).toBe(100)
    expect(out).toEqual({ cash: 60, bank: 40 })
  })
})
