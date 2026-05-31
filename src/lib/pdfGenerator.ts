import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { AppState } from './store'
import { formatCurrency, formatDate } from './data'

export async function generateLoanDocument(state: AppState) {
  const doc = new jsPDF()
  
  // Basic Info
  const businessName = state.businessProfile?.business_name || state.user?.business_name || "SerwaaBroni Vendor"
  const phone = state.businessProfile?.phone || state.user?.phone || "N/A"
  const today = new Date()

  // 1. Header
  doc.setFontSize(22)
  doc.setTextColor(33, 33, 33)
  doc.text(businessName.toUpperCase(), 14, 20)

  doc.setFontSize(12)
  doc.setTextColor(100, 100, 100)
  doc.text('MICRO-LOAN FINANCIAL STATEMENT', 14, 28)

  doc.setFontSize(10)
  doc.text(`Generated on: ${formatDate(today.toISOString())}`, 14, 34)
  doc.text(`Phone: ${phone}`, 14, 39)

  // Divider
  doc.setDrawColor(200, 200, 200)
  doc.line(14, 45, 196, 45)

  // 2. Compute 90-Day Best Practice Metrics
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString()
  
  const recentSales = state.sales.filter(s => s.created_at >= ninetyDaysAgo)
  const recentExpenses = state.expenses.filter(e => e.created_at >= ninetyDaysAgo)

  const totalSales = recentSales.reduce((sum, s) => sum + s.total, 0)
  const totalProfit = recentSales.reduce((sum, s) => sum + s.profit, 0)
  const totalExpenses = recentExpenses.reduce((sum, e) => sum + e.amount, 0)
  const netIncome = totalProfit - totalExpenses

  // Current Inventory Value
  const inventoryValue = state.products.reduce((sum, p) => sum + (p.quantity * p.cost_price), 0)

  // 3. Business Health Summary (Grid)
  doc.setFontSize(14)
  doc.setTextColor(33, 33, 33)
  doc.text('Business Health Summary (Last 90 Days)', 14, 55)

  autoTable(doc, {
    startY: 60,
    head: [['Metric', 'Value']],
    body: [
      ['Total Sales (Revenue)', formatCurrency(totalSales)],
      ['Gross Profit', formatCurrency(totalProfit)],
      ['Total Expenses', formatCurrency(totalExpenses)],
      ['Net Income', formatCurrency(netIncome)],
      ['Current Inventory Value', formatCurrency(inventoryValue)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  })

  // 4. Top Selling Products (Last 90 Days)
  const productSales: Record<string, { qty: number; total: number }> = {}
  recentSales.forEach(s => {
    if (!productSales[s.product_name]) productSales[s.product_name] = { qty: 0, total: 0 }
    productSales[s.product_name].qty += s.quantity
    productSales[s.product_name].total += s.total
  })
  
  const topProducts = Object.entries(productSales)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)

  doc.setFontSize(14)
  doc.setTextColor(33, 33, 33)
  const finalY = (doc as any).lastAutoTable.finalY || 60
  doc.text('Top 5 Selling Items (Last 90 Days)', 14, finalY + 15)

  autoTable(doc, {
    startY: finalY + 20,
    head: [['Product Name', 'Quantity Sold', 'Total Revenue']],
    body: topProducts.map(([name, stats]) => [
      name,
      stats.qty.toString(),
      formatCurrency(stats.total)
    ]),
    theme: 'striped',
    headStyles: { fillColor: [80, 80, 80] },
  })

  // 5. Debt Summary
  const owedList = state.debts.filter(d => d.type === 'owed' && !d.is_paid)
  const owingList = state.debts.filter(d => d.type === 'owing' && !d.is_paid)
  
  const totalOwed = owedList.reduce((sum, d) => sum + d.amount, 0)
  const totalOwing = owingList.reduce((sum, d) => sum + d.amount, 0)

  const debtY = (doc as any).lastAutoTable.finalY || finalY + 20
  doc.setFontSize(14)
  doc.setTextColor(33, 33, 33)
  doc.text('Outstanding Debts', 14, debtY + 15)

  autoTable(doc, {
    startY: debtY + 20,
    head: [['Description', 'Amount']],
    body: [
      ['Total Money Owed TO Business (Receivables)', formatCurrency(totalOwed)],
      ['Total Money Owed BY Business (Payables)', formatCurrency(totalOwing)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [40, 40, 40] },
    bodyStyles: { textColor: [50, 50, 50] }
  })

  // 6. Footer
  const pageHeight = doc.internal.pageSize.height || 297
  doc.setFontSize(8)
  doc.setTextColor(150, 150, 150)
  doc.text('Generated securely by SerwaaBroni Market App - Empowering African Commerce', 14, pageHeight - 10)

  // Trigger Download
  doc.save(`${businessName.replace(/\s+/g, '_')}_Financial_Statement.pdf`)
}
