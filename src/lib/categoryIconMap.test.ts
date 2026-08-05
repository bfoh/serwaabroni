import { describe, it, expect } from 'vitest'
import { CATEGORY_ICON_MAP } from './categoryIconMap'
import { CURATED_ICONS } from './categories'

describe('CATEGORY_ICON_MAP', () => {
  it('has a component for every curated icon key', () => {
    for (const key of CURATED_ICONS) {
      expect(CATEGORY_ICON_MAP[key]).toBeDefined()
    }
  })

  it('has no keys outside the curated list', () => {
    expect(Object.keys(CATEGORY_ICON_MAP).sort()).toEqual([...CURATED_ICONS].sort())
  })
})
