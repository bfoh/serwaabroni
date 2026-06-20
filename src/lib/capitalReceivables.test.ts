import { describe, it, expect } from 'vitest'
import { splitCreditReceivables, type ReceivableTab } from './capitalReceivables'

describe('splitCreditReceivables', () => {
  it('single-loan cart: share is the whole outstanding', () => {
    const tabs: Record<string, ReceivableTab> = {
      g1: { sale_group_id: 'g1', amount: 100, amount_paid: 20, is_paid: false },
    }
    const out = splitCreditReceivables(
      [{ injection_id: 'A', sale_group_id: 'g1', lineValue: 100 }],
      tabs,
    )
    expect(out.A).toHaveLength(1)
    expect(out.A[0].shareOutstanding).toBeCloseTo(80)
    expect(out.A[0].fullOutstanding).toBeCloseTo(80)
    expect(out.A[0].fullAmount).toBe(100)
  })

  it('two-loan cart: shares sum to the tab outstanding', () => {
    const tabs: Record<string, ReceivableTab> = {
      g1: { sale_group_id: 'g1', amount: 100, amount_paid: 0, is_paid: false },
    }
    const out = splitCreditReceivables(
      [
        { injection_id: 'A', sale_group_id: 'g1', lineValue: 60 },
        { injection_id: 'B', sale_group_id: 'g1', lineValue: 40 },
      ],
      tabs,
    )
    expect(out.A[0].shareOutstanding).toBeCloseTo(60)
    expect(out.B[0].shareOutstanding).toBeCloseTo(40)
    expect(out.A[0].shareOutstanding + out.B[0].shareOutstanding).toBeCloseTo(100)
  })

  it('untracked remainder: shares sum to less than outstanding', () => {
    // Cart total 100 but only 70 worth came from tracked loan A.
    const tabs: Record<string, ReceivableTab> = {
      g1: { sale_group_id: 'g1', amount: 100, amount_paid: 0, is_paid: false },
    }
    const out = splitCreditReceivables(
      [{ injection_id: 'A', sale_group_id: 'g1', lineValue: 70 }],
      tabs,
    )
    expect(out.A[0].shareOutstanding).toBeCloseTo(70)
  })

  it('excludes paid tabs', () => {
    const tabs: Record<string, ReceivableTab> = {
      g1: { sale_group_id: 'g1', amount: 100, amount_paid: 100, is_paid: true },
    }
    const out = splitCreditReceivables(
      [{ injection_id: 'A', sale_group_id: 'g1', lineValue: 100 }],
      tabs,
    )
    expect(out.A ?? []).toHaveLength(0)
  })
})
