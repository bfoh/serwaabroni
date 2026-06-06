import { describe, it, expect } from 'vitest'
import { generateInstallments, computeRisk, type RiskInput } from './capitalRisk'

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

const base: RiskInput = {
  injectionDate: '2026-01-01T00:00:00.000Z',
  paybackMonths: 5,
  totalRepayable: 5750,
  recoveredProfit: 2760,
  installments: [],
  now: '2026-04-01T00:00:00.000Z', // ~90 days into a ~150 day term
}

describe('computeRisk', () => {
  it('projects recovery from the current profit pace', () => {
    const r = computeRisk(base)
    // pace = 2760/90 ≈ 30.67/day; term ≈ 150 days → projected ≈ 4600
    expect(r.projected).toBeGreaterThan(4400)
    expect(r.projected).toBeLessThan(4800)
    expect(r.tier).toBe('at_risk') // projected < 85% of 5750 (=4887)
    expect(r.shortfall).toBeGreaterThan(0)
  })

  it('is on_track when projected meets the total and nothing is overdue', () => {
    const r = computeRisk({ ...base, recoveredProfit: 3600 }) // pace 40/day → ~6000
    expect(r.tier).toBe('on_track')
    expect(r.shortfall).toBe(0)
  })

  it('is watch when projected lands between 85% and 100% of the total', () => {
    const r = computeRisk({ ...base, recoveredProfit: 3150 }) // ~5250 projected (91%)
    expect(r.tier).toBe('watch')
  })

  it('escalates to at_risk when an installment is overdue and underpaid', () => {
    const r = computeRisk({
      ...base,
      recoveredProfit: 3600, // would be on_track on pace alone
      installments: [
        { due_date: '2026-02-01T00:00:00.000Z', amount_due: 1150, amount_paid: 0 },
      ],
    })
    expect(r.tier).toBe('at_risk')
  })

  it('guards day zero (no divide-by-zero)', () => {
    const r = computeRisk({ ...base, now: base.injectionDate, recoveredProfit: 0 })
    expect(Number.isFinite(r.projected)).toBe(true)
  })

  it('reports the weekly profit needed to close the gap', () => {
    const r = computeRisk(base)
    expect(r.requiredProfitPerWeek).toBeGreaterThan(0)
  })
})
