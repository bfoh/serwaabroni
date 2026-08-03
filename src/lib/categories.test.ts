import { describe, it, expect } from 'vitest'
import { INDUSTRIES, INDUSTRY_TEMPLATES, CURATED_ICONS, templateForIndustry, mergeSeedNames } from './categories'

describe('INDUSTRIES', () => {
  it('lists exactly the 7 approved industries in order', () => {
    expect(INDUSTRIES).toEqual([
      'Supermarket', 'Hardware/Plumbing', 'Hair & Beauty', 'Fashion/Clothing',
      'Electronics', 'Pharmacy', 'General/Other',
    ])
  })
})

describe('templateForIndustry', () => {
  it('returns the Supermarket template unchanged (legacy 8 categories)', () => {
    expect(templateForIndustry('Supermarket').map((c) => c.name)).toEqual([
      'Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery',
    ])
  })

  it('falls back to General/Other for an unrecognized industry', () => {
    expect(templateForIndustry('Not A Real Industry')).toEqual(INDUSTRY_TEMPLATES['General/Other'])
  })
})

describe('mergeSeedNames', () => {
  it('keeps only template entries not already present, case-insensitively', () => {
    const existing = ['groceries', 'Dairy', 'Bakery']
    const result = mergeSeedNames(existing, INDUSTRY_TEMPLATES['Supermarket'])
    expect(result.map((c) => c.name)).toEqual(['Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles'])
  })

  it('returns the full template when nothing exists yet', () => {
    expect(mergeSeedNames([], INDUSTRY_TEMPLATES['Pharmacy'])).toEqual(INDUSTRY_TEMPLATES['Pharmacy'])
  })
})

describe('CURATED_ICONS', () => {
  it('has exactly 24 unique icon keys', () => {
    expect(CURATED_ICONS.length).toBe(24)
    expect(new Set(CURATED_ICONS).size).toBe(24)
  })
})
