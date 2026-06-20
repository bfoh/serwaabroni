import { describe, it, expect } from 'vitest'
import { computeRecovered, type RecoverySale, type RecoveryTab } from './capitalRecovery'

const cashSale: RecoverySale = { sale_group_id: 'g1', payment_method: 'cash', created_at: '2026-06-10T00:00:00Z' }
const creditSale: RecoverySale = { sale_group_id: 'g2', payment_method: 'credit', created_at: '2026-06-10T00:00:00Z' }

describe('computeRecovered', () => {
  it('counts cash-sale profit fully', () => {
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: cashSale }, {},
    )
    expect(out.A).toBe(100)
  })

  it('counts zero for an unpaid credit sale', () => {
    const tab: RecoveryTab = { amount: 50, amount_paid: 0, payments: [] }
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: creditSale }, { g2: tab },
    )
    expect(out.A ?? 0).toBe(0) // unpaid → omitted from the map
  })

  it('counts credit profit proportional to amount paid', () => {
    const tab: RecoveryTab = { amount: 50, amount_paid: 40, payments: [{ amount: 40, date: '2026-06-12T00:00:00Z' }] }
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: creditSale }, { g2: tab },
    )
    expect(out.A).toBeCloseTo(80) // 40/50 = 0.8
  })

  it('treats a credit sale with no tab as fully paid', () => {
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: creditSale }, {},
    )
    expect(out.A).toBe(100)
  })

  it('splits across injections by their own consumption rows', () => {
    const out = computeRecovered(
      [
        { injection_id: 'A', sale_id: 's1', profit: 30 },
        { injection_id: 'B', sale_id: 's1', profit: 70 },
      ],
      { s1: cashSale }, {},
    )
    expect(out.A).toBe(30)
    expect(out.B).toBe(70)
  })

  it('period filter: cash counts only if sale is within period', () => {
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: cashSale }, {},
      '2026-06-15T00:00:00Z', // sale was 06-10, before cutoff
    )
    expect(out.A ?? 0).toBe(0)
  })

  it('period filter: credit counts payments landing in the period', () => {
    const tab: RecoveryTab = {
      amount: 100, amount_paid: 60,
      payments: [
        { amount: 20, date: '2026-06-01T00:00:00Z' }, // before cutoff
        { amount: 40, date: '2026-06-18T00:00:00Z' }, // in period
      ],
    }
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: creditSale }, { g2: tab },
      '2026-06-15T00:00:00Z',
    )
    expect(out.A).toBeCloseTo(40) // 40/100 of profit
  })
})
