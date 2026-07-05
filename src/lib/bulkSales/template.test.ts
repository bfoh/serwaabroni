import { describe, it, expect } from 'vitest'
import { SALES_TEMPLATE_HEADERS, buildSalesTemplateCSV } from './template'

describe('buildSalesTemplateCSV', () => {
  it('has the documented headers in order', () => {
    expect(SALES_TEMPLATE_HEADERS).toEqual(['Product', 'Quantity', 'Unit', 'Unit Price', 'Payment', 'Customer', 'Date'])
  })
  it('emits a header row plus a cash example and a credit example', () => {
    const lines = buildSalesTemplateCSV().split('\n')
    expect(lines[0]).toBe('Product,Quantity,Unit,Unit Price,Payment,Customer,Date')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('cash')
    expect(lines[2]).toContain('credit')
  })
})
