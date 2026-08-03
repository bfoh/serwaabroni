import { describe, it, expect } from 'vitest'
import { canDeleteCategory, applyCategoryRename } from './categoriesLogic'

describe('canDeleteCategory', () => {
  it('allows deleting a category no product uses', () => {
    const products = [{ category: 'Dairy' }, { category: 'Bakery' }]
    expect(canDeleteCategory('Grains', products)).toEqual({ allowed: true, count: 0 })
  })

  it('blocks deleting a category products still use, reporting the count', () => {
    const products = [{ category: 'Dairy' }, { category: 'Dairy' }, { category: 'Bakery' }]
    expect(canDeleteCategory('Dairy', products)).toEqual({ allowed: false, count: 2 })
  })
})

describe('applyCategoryRename', () => {
  it('renames matching products only, leaving others untouched', () => {
    const products = [{ id: '1', category: 'Dairy' }, { id: '2', category: 'Bakery' }]
    expect(applyCategoryRename(products, 'Dairy', 'Milk & Cheese')).toEqual([
      { id: '1', category: 'Milk & Cheese' },
      { id: '2', category: 'Bakery' },
    ])
  })

  it('is a no-op when no product uses the old name', () => {
    const products = [{ id: '1', category: 'Bakery' }]
    expect(applyCategoryRename(products, 'Dairy', 'Milk')).toEqual(products)
  })
})
