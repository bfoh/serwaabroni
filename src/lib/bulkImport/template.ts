import { download } from '@/lib/export'
import { toCSVRow } from './csv'

export const TEMPLATE_HEADERS = [
  'Name', 'Quantity', 'Unit', 'Cost Price', 'Selling Price',
  'Category', 'Pack Unit', 'Units Per Pack', 'Low Stock Threshold',
]

// Two examples: a per-piece good, and a pack good (Quantity + prices per BOX,
// since Units Per Pack ≥ 2 means the row is read per pack and converted to base).
const EXAMPLE_ROWS = [
  ['Milo', 12, 'tin', 4, 8, 'Beverages', '', '', 5],
  ['Indomie', 5, 'sachet', 100, 120, 'Noodles', 'box', 40, 20],
]

export function buildTemplateCSV(): string {
  return [toCSVRow(TEMPLATE_HEADERS), ...EXAMPLE_ROWS.map(toCSVRow)].join('\n')
}

export function downloadTemplate(): void {
  download('serwaabroni-stock-template.csv', '﻿' + buildTemplateCSV())
}
