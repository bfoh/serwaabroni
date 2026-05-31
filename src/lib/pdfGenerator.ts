import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { AppState } from './store'
import { formatCurrency, formatDate } from './data'

// Helper to replace unsupported ₵ symbol with GHS for PDF rendering
const pdfCurrency = (amount: number) => formatCurrency(amount).replace('GH₵', 'GHS')

export async function generateLoanDocument(state: AppState) {
  const doc = new jsPDF()
  
  // Basic Info
  const businessName = state.businessProfile?.business_name || state.user?.business_name || "SerwaaBroni Vendor"
  const phone = state.businessProfile?.phone || state.user?.phone || "N/A"
  const today = new Date()

  // 1. Header
  doc.setFontSize(22)
  doc.setTextColor(20, 20, 20)
  doc.text(businessName.toUpperCase(), 14, 20)

  doc.setFontSize(12)
  doc.setTextColor(80, 80, 80)
  doc.text('OFFICIAL BUSINESS FINANCIAL STATEMENT', 14, 28)
  
  doc.setFontSize(10)
  doc.setTextColor(100, 100, 100)
  doc.text(`Date of Issue: ${formatDate(today.toISOString())}`, 14, 34)
  doc.text(`Contact: ${phone}`, 14, 39)

  doc.setDrawColor(200, 200, 200)
  doc.line(14, 44, 196, 44)

  // Introduction Letter
  doc.setFontSize(10)
  doc.setTextColor(50, 50, 50)
  const introText = "To Whom It May Concern,\n\nThis document serves as an official summary of the financial performance and current standing of the business named above. The data contained herein represents recorded transactions over the last 90 days and is intended to support applications for micro-loans, credit facilities, or financial assessment."
  const splitIntro = doc.splitTextToSize(introText, 180)
  doc.text(splitIntro, 14, 52)

  // 2. Compute 90-Day Best Practice Metrics
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString()
  
  const recentSales = state.sales.filter(s => s.created_at >= ninetyDaysAgo)
  const recentExpenses = state.expenses.filter(e => e.created_at >= ninetyDaysAgo)

  const totalSales = recentSales.reduce((sum, s) => sum + s.total, 0)
  const totalProfit = recentSales.reduce((sum, s) => sum + s.profit, 0)
  const cogs = totalSales - totalProfit // Cost of Goods Sold
  const totalExpenses = recentExpenses.reduce((sum, e) => sum + e.amount, 0)
  const netIncome = totalProfit - totalExpenses

  // Current Inventory Value
  const inventoryValue = state.products.reduce((sum, p) => sum + (p.quantity * p.cost_price), 0)

  // 3. Profit & Loss Statement
  autoTable(doc, {
    startY: 75,
    head: [['PROFIT & LOSS STATEMENT (LAST 90 DAYS)', 'AMOUNT']],
    body: [
      ['Gross Revenue (Total Sales)', pdfCurrency(totalSales)],
      ['Cost of Goods Sold (COGS)', pdfCurrency(cogs)],
      ['Gross Profit', pdfCurrency(totalProfit)],
      ['Operating Expenses', pdfCurrency(totalExpenses)],
      ['NET PROFIT', pdfCurrency(netIncome)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [245, 248, 250] },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  })

  // 4. Balance Sheet Snapshot
  const owedList = state.debts.filter(d => d.type === 'owed' && !d.is_paid)
  const owingList = state.debts.filter(d => d.type === 'owing' && !d.is_paid)
  
  const totalOwed = owedList.reduce((sum, d) => sum + d.amount, 0)
  const totalOwing = owingList.reduce((sum, d) => sum + d.amount, 0)

  const finalY1 = (doc as any).lastAutoTable.finalY || 130

  autoTable(doc, {
    startY: finalY1 + 10,
    head: [['BALANCE SHEET SNAPSHOT (CURRENT)', 'AMOUNT']],
    body: [
      ['Total Stock Value (Inventory)', pdfCurrency(inventoryValue)],
      ['Accounts Receivable (Money owed to business)', pdfCurrency(totalOwed)],
      ['Accounts Payable (Money owed by business)', pdfCurrency(totalOwing)],
    ],
    theme: 'grid',
    headStyles: { fillColor: [39, 174, 96], textColor: 255, fontStyle: 'bold' },
    bodyStyles: { textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: [240, 249, 244] },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  })

  // 5. Loan Application Details (Fillable)
  const finalY2 = (doc as any).lastAutoTable.finalY || 180
  
  doc.setFontSize(12)
  doc.setTextColor(20, 20, 20)
  doc.setFont('helvetica', 'bold')
  doc.text('LOAN REQUEST DETAILS', 14, finalY2 + 15)
  
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('Requested Loan Amount: GHS ___________________________', 14, finalY2 + 25)
  doc.text('Purpose of Loan: __________________________________________________________________', 14, finalY2 + 35)

  // 6. Signatures
  doc.text('DECLARATION: I hereby declare that the information provided above is true and accurate.', 14, finalY2 + 55)
  
  doc.setDrawColor(0, 0, 0)
  doc.line(14, finalY2 + 80, 80, finalY2 + 80)
  doc.text('Business Owner Signature', 14, finalY2 + 85)

  doc.line(120, finalY2 + 80, 196, finalY2 + 80)
  doc.text('Date', 120, finalY2 + 85)

  // 7. Footer
  const pageHeight = doc.internal.pageSize.height || 297
  doc.setFontSize(8)
  doc.setTextColor(150, 150, 150)
  doc.text('Generated securely by the SerwaaBroni Market App - Verified Digital Records', 14, pageHeight - 10)

  // Trigger Download
  doc.save(`${businessName.replace(/\s+/g, '_')}_Loan_Application.pdf`)
}
