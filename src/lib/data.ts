import type { Product, Sale, Debt, Expense } from './supabase'

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// Format currency in Ghana Cedis
export function formatCurrency(amount: number): string {
  return `GH\u20B5 ${amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Format date
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })
}

// Local storage helpers
const STORAGE_KEY = 'serwaabroni_data'
const DATA_VERSION = 'v3' // bump to force re-seed and clear dummy data

interface StoredData {
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  customers: any[]
  businessName: string
  ownerName: string
}

// Seed data for first-time users (now empty)
const seedProducts: Product[] = []
const seedSales: Sale[] = []
const seedDebts: Debt[] = []
const seedExpenses: Expense[] = []

export function loadData(): StoredData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as StoredData & { version?: string }
      // Re-seed if version mismatch or products empty
      if (parsed.version === DATA_VERSION && parsed.products && parsed.products.length > 0) {
        return parsed
      }
    }
  } catch {
    // ignore parse errors
  }
  // Return seed data for first time (or after version bump)
  const data: StoredData & { version: string } = {
    products: seedProducts,
    sales: seedSales,
    debts: seedDebts,
    expenses: seedExpenses,
    customers: [],
    businessName: "Maame Doku's Shop",
    ownerName: 'Maame Doku',
    version: DATA_VERSION,
  }
  saveData(data)
  return data
}

export function saveData(data: StoredData & { version?: string }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, version: DATA_VERSION }))
  } catch {
    // ignore storage errors
  }
}

export function getTodaySales(sales: Sale[]): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return sales
    .filter((s) => new Date(s.created_at) >= today)
    .reduce((sum, s) => sum + s.total, 0)
}

export function getPendingDebts(debts: Debt[]): number {
  return debts.filter((d) => d.type === 'owed' && !d.is_paid).reduce((sum, d) => sum + d.amount, 0)
}

export function getWeeklySales(sales: Sale[]): number {
  const weekAgo = new Date(Date.now() - 7 * 86400000)
  return sales.filter((s) => new Date(s.created_at) >= weekAgo).reduce((sum, s) => sum + s.total, 0)
}

export function getMonthlySales(sales: Sale[]): number {
  const monthAgo = new Date(Date.now() - 30 * 86400000)
  return sales.filter((s) => new Date(s.created_at) >= monthAgo).reduce((sum, s) => sum + s.total, 0)
}

export function getProfitForPeriod(sales: Sale[], days: number): number {
  const startDate = new Date(Date.now() - days * 86400000)
  return sales.filter((s) => new Date(s.created_at) >= startDate).reduce((sum, s) => sum + s.profit, 0)
}

export function getStockValue(products: Product[]): number {
  return products.reduce((sum, p) => sum + p.cost_price * p.quantity, 0)
}

export function getProjectedProfit(products: Product[]): number {
  return products.reduce((sum, p) => sum + (p.selling_price - p.cost_price) * p.quantity, 0)
}
