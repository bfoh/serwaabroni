import { describe, it, expect } from 'vitest'
import { unitOptionsForIndustry, smallUnitOptionsForIndustry } from './unitOptions'
import { INDUSTRIES } from './categories'

describe('unitOptionsForIndustry', () => {
  it('returns a distinct, non-empty list for every industry', () => {
    for (const industry of INDUSTRIES) {
      const options = unitOptionsForIndustry(industry)
      expect(options.length).toBeGreaterThan(0)
      expect(new Set(options.map((o) => o.value)).size).toBe(options.length)
    }
  })

  it('falls back to General/Other for an unrecognized industry', () => {
    expect(unitOptionsForIndustry('Not A Real Industry')).toEqual(unitOptionsForIndustry('General/Other'))
  })

  it('falls back to General/Other for null/undefined', () => {
    expect(unitOptionsForIndustry(null)).toEqual(unitOptionsForIndustry('General/Other'))
    expect(unitOptionsForIndustry(undefined)).toEqual(unitOptionsForIndustry('General/Other'))
  })

  it('every industry offers Piece', () => {
    for (const industry of INDUSTRIES) {
      expect(unitOptionsForIndustry(industry).some((o) => o.value === 'piece')).toBe(true)
    }
  })
})

describe('smallUnitOptionsForIndustry', () => {
  it('returns a distinct, non-empty list for every industry', () => {
    for (const industry of INDUSTRIES) {
      const options = smallUnitOptionsForIndustry(industry)
      expect(options.length).toBeGreaterThan(0)
      expect(new Set(options.map((o) => o.value)).size).toBe(options.length)
    }
  })

  it('falls back to General/Other for an unrecognized industry', () => {
    expect(smallUnitOptionsForIndustry('Not A Real Industry')).toEqual(smallUnitOptionsForIndustry('General/Other'))
  })
})
