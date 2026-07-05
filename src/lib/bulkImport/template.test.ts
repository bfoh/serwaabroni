import { describe, it, expect } from 'vitest'
import { TEMPLATE_HEADERS, buildTemplateCSV } from './template'

describe('buildTemplateCSV', () => {
  it('has the documented headers in order', () => {
    expect(TEMPLATE_HEADERS).toEqual([
      'Name', 'Quantity', 'Unit', 'Cost Price', 'Selling Price',
      'Category', 'Pack Unit', 'Units Per Pack', 'Low Stock Threshold',
    ])
  })
  it('emits a header row plus a piece example and a pack example', () => {
    const lines = buildTemplateCSV().split('\n')
    expect(lines[0]).toBe('Name,Quantity,Unit,Cost Price,Selling Price,Category,Pack Unit,Units Per Pack,Low Stock Threshold')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('Milo')                 // per-piece example
    expect(lines[2]).toContain('Indomie')              // pack example
    expect(lines[2]).toContain('box')
  })
})
