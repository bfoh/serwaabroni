import { describe, it, expect } from 'vitest'
import { generateInstallments } from './capitalRisk'

describe('generateInstallments', () => {
  it('splits the total into equal monthly amounts', () => {
    const rows = generateInstallments(900, 3, '2026-01-15T00:00:00.000Z')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.amount_due)).toEqual([300, 300, 300])
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3])
  })

  it('puts the rounding remainder on the last installment so the sum is exact', () => {
    const rows = generateInstallments(1000, 3, '2026-01-15T00:00:00.000Z')
    const sum = rows.reduce((s, r) => s + r.amount_due, 0)
    expect(sum).toBeCloseTo(1000, 2)
    expect(rows[0].amount_due).toBe(333.33)
    expect(rows[2].amount_due).toBeCloseTo(333.34, 2)
  })

  it('spaces due dates one month apart from the injection date', () => {
    const rows = generateInstallments(900, 3, '2026-01-15T00:00:00.000Z')
    expect(rows[0].due_date.slice(0, 10)).toBe('2026-02-15')
    expect(rows[1].due_date.slice(0, 10)).toBe('2026-03-15')
    expect(rows[2].due_date.slice(0, 10)).toBe('2026-04-15')
  })
})
