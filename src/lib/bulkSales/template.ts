import { download } from '@/lib/export'
import { toCSVRow } from '@/lib/bulkImport/csv'

export const SALES_TEMPLATE_HEADERS = ['Product', 'Quantity', 'Unit', 'Unit Price', 'Payment', 'Customer', 'Date']

// Unit Price / Customer / Date may be left blank. Payment is cash | momo | bank | credit.
const EXAMPLE_ROWS = [
  ['Milo', 2, 'tin', '', 'cash', '', '2026-07-03'],
  ['Indomie', 5, 'sachet', '', 'credit', 'Ama', '2026-07-03'],
]

export function buildSalesTemplateCSV(): string {
  return [toCSVRow(SALES_TEMPLATE_HEADERS), ...EXAMPLE_ROWS.map(toCSVRow)].join('\n')
}

export function downloadSalesTemplate(): void {
  download('serwaabroni-sales-template.csv', '﻿' + buildSalesTemplateCSV())
}
