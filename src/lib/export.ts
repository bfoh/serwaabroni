import type { AppState } from '@/lib/store'
import type { Product, Sale, Debt, Expense } from '@/lib/supabase'

function toCSV(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (val: string | number | null) => {
    if (val === null || val === undefined) return ''
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"'
    }
    return str
  }
  return [headers.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n')
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export function exportToCSV(state: AppState) {
  const timestamp = new Date().toISOString().split('T')[0]

  // Export Products
  if (state.products.length > 0) {
    const productCSV = toCSV(
      ['ID', 'Name', 'Category', 'Cost Price', 'Selling Price', 'Quantity', 'Unit', 'Low Stock', 'Barcode', 'Created At'],
      state.products.map((p: Product) => [p.id, p.name, p.category, p.cost_price, p.selling_price, p.quantity, p.unit, p.low_stock_threshold, p.barcode || '', p.created_at])
    )
    download(`serwaabroni-products-${timestamp}.csv`, '\uFEFF' + productCSV)
  }

  // Export Sales
  if (state.sales.length > 0) {
    const salesCSV = toCSV(
      ['ID', 'Product', 'Quantity', 'Unit Price', 'Total', 'Profit', 'Customer', 'Phone', 'Payment', 'Date'],
      state.sales.map((s: Sale) => [s.id, s.product_name, s.quantity, s.unit_price, s.total, s.profit || 0, s.customer_name || '', s.customer_phone || '', s.payment_method || 'cash', s.created_at])
    )
    download(`serwaabroni-sales-${timestamp}.csv`, '\uFEFF' + salesCSV)
  }

  // Export Debts
  if (state.debts.length > 0) {
    const debtsCSV = toCSV(
      ['ID', 'Person', 'Phone', 'Amount', 'Type', 'Description', 'Due Date', 'Paid', 'Paid At', 'Date'],
      state.debts.map((d: Debt) => [d.id, d.person_name, d.phone || '', d.amount, d.type, d.description || '', d.due_date || '', d.is_paid ? 'Yes' : 'No', d.paid_at || '', d.created_at])
    )
    download(`serwaabroni-debts-${timestamp}.csv`, '\uFEFF' + debtsCSV)
  }

  // Export Expenses
  if (state.expenses.length > 0) {
    const expensesCSV = toCSV(
      ['ID', 'Name', 'Category', 'Amount', 'Notes', 'Date'],
      state.expenses.map((e: Expense) => [e.id, e.name, e.category || '', e.amount, e.notes || '', e.created_at])
    )
    download(`serwaabroni-expenses-${timestamp}.csv`, '\uFEFF' + expensesCSV)
  }
}