import type { Product, Sale, Debt, Expense, Customer } from './supabase'

export type AlertType = 'warning' | 'danger' | 'info' | 'success'

export interface Alert {
  id: string
  type: AlertType
  title: string
  message: string
  actionLabel?: string
  actionLink?: string
  actionPhone?: string
  isCritical?: boolean
}

// Generate a quick unique ID for alerts
const uid = () => Math.random().toString(36).substring(2, 9)

export function generateAlerts(
  products: Product[],
  sales: Sale[],
  debts: Debt[],
  expenses: Expense[],
  customers: Customer[]
): Alert[] {
  const alerts: Alert[] = []

  // 1. INVENTORY ALERTS
  products.forEach(p => {
    if (p.quantity === 0) {
      alerts.push({
        id: `out-stock-${p.id}`,
        type: 'danger',
        title: 'Out of Stock!',
        message: `Warning! You have completely run out of ${p.name}. You are losing sales.`,
        actionLabel: 'Restock',
        actionLink: 'stock',
        isCritical: true,
      })
    } else if (p.quantity <= (p.low_stock_threshold || 5)) {
      alerts.push({
        id: `low-stock-${p.id}`,
        type: 'warning',
        title: 'Low Stock',
        message: `Auntie, you only have ${p.quantity} ${p.unit}s of ${p.name} left. Please restock soon!`,
        actionLabel: 'View Stock',
        actionLink: 'stock',
        isCritical: false,
      })
    }
  })

  // 2. CREDIT & DEBT ALERTS
  const today = new Date()
  today.setHours(0,0,0,0)

  debts.forEach(d => {
    if (!d.is_paid && d.due_date) {
      const dueDate = new Date(d.due_date)
      dueDate.setHours(0,0,0,0)
      
      const diffTime = dueDate.getTime() - today.getTime()
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      if (d.type === 'owed') {
        if (diffDays === 0) {
          alerts.push({
            id: `debt-due-${d.id}`,
            type: 'warning',
            title: 'Debt Collection Due Today',
            message: `Time to collect! ${d.person_name} promised to pay their GH₵${d.amount} debt today.`,
            actionLabel: d.phone ? 'Call Customer' : 'View Debt',
            actionPhone: d.phone || undefined,
            actionLink: 'debts',
            isCritical: true,
          })
        } else if (diffDays < 0) {
          alerts.push({
            id: `debt-overdue-${d.id}`,
            type: 'danger',
            title: 'Overdue Debt',
            message: `${d.person_name} is ${Math.abs(diffDays)} days late on their GH₵${d.amount} payment.`,
            actionLabel: d.phone ? 'Call Customer' : 'View Debt',
            actionPhone: d.phone || undefined,
            actionLink: 'debts',
            isCritical: true,
          })
        }
      } else if (d.type === 'owing') {
        if (diffDays >= 0 && diffDays <= 2) {
          alerts.push({
            id: `supplier-due-${d.id}`,
            type: 'warning',
            title: 'Supplier Payment Soon',
            message: `Remember to pay ${d.person_name} their GH₵${d.amount} by ${dueDate.toLocaleDateString('en-GB')}.`,
            actionLabel: 'View Debts',
            actionLink: 'debts',
            isCritical: false,
          })
        }
      }
    }
  })

  // 3. BUSINESS HEALTH
  const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00'
  const todayExpenses = expenses.filter(e => e.created_at >= todayStart).reduce((sum, e) => sum + e.amount, 0)
  const todayProfit = sales.filter(s => s.created_at >= todayStart).reduce((sum, s) => sum + s.profit, 0)
  const todaySales = sales.filter(s => s.created_at >= todayStart).reduce((sum, s) => sum + s.total, 0)

  if (todayExpenses > todayProfit && todayExpenses > 0) {
    alerts.push({
      id: `negative-cashflow-${todayStart}`,
      type: 'danger',
      title: 'Negative Cashflow',
      message: `Careful! You have spent more on expenses (GH₵${todayExpenses}) than you made in profit (GH₵${todayProfit}) today.`,
      isCritical: true,
    })
  }

  // Large single expense
  const recentHighExpense = expenses.find(e => e.amount > 500 && e.created_at >= todayStart)
  if (recentHighExpense) {
    alerts.push({
      id: `high-expense-${recentHighExpense.id}`,
      type: 'warning',
      title: 'Unusually High Expense',
      message: `Warning: You recorded a large expense of GH₵${recentHighExpense.amount} for "${recentHighExpense.name}". Is this correct?`,
      isCritical: false,
    })
  }

  // 4. BANKING & SECURITY
  // Calculate cash vs momo logic (simplified: sum cash sales past 3 days)
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()
  const recentCashSales = sales
    .filter(s => s.created_at >= threeDaysAgo && s.payment_method === 'cash')
    .reduce((sum, s) => sum + s.total, 0)
  
  if (recentCashSales > 2000) {
    alerts.push({
      id: `high-cash-${todayStart}`,
      type: 'warning',
      title: 'High Cash on Hand',
      message: `Security Alert: You have collected GH₵${recentCashSales} in cash recently. Please deposit it at the bank or a MoMo vendor to stay safe.`,
      isCritical: true,
    })
  }

  return alerts
}
