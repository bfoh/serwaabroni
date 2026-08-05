import { describe, it, expect } from 'vitest'
import { INDUSTRIES, INDUSTRY_TEMPLATES, CURATED_ICONS, templateForIndustry, mergeSeedNames } from './categories'

describe('INDUSTRIES', () => {
  it('lists exactly the 15 approved industries in order, General/Other last', () => {
    expect(INDUSTRIES).toEqual([
      'Supermarket', 'Hardware/Plumbing', 'Building Materials', 'Hair & Beauty',
      'Fashion/Clothing', 'Second-Hand Goods', 'Electronics', 'Telecom & Mobile Money',
      'Pharmacy', 'Food & Beverages', 'Auto Parts & Spares', 'Agro & Farm Supplies',
      'Furniture & Woodworking', 'Stationery & Books', 'General/Other',
    ])
  })

  it('has a template for every industry', () => {
    for (const industry of INDUSTRIES) {
      expect(INDUSTRY_TEMPLATES[industry]).toBeDefined()
      expect(INDUSTRY_TEMPLATES[industry].length).toBeGreaterThan(0)
    }
  })

  it('every template entry uses a curated icon key', () => {
    for (const industry of INDUSTRIES) {
      for (const entry of INDUSTRY_TEMPLATES[industry]) {
        expect(CURATED_ICONS).toContain(entry.icon)
      }
    }
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
  it('has exactly 69 unique icon keys', () => {
    expect(CURATED_ICONS.length).toBe(69)
    expect(new Set(CURATED_ICONS).size).toBe(69)
  })
})
