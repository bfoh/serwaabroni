import type { Product, Sale, Debt, Expense } from './supabase'

// Generate a unique ID
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
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
const DATA_VERSION = 'v2' // bump to force re-seed

interface StoredData {
  products: Product[]
  sales: Sale[]
  debts: Debt[]
  expenses: Expense[]
  customers: any[]
  businessName: string
  ownerName: string
}

// Seed data for first-time users
const seedProducts: Product[] = [
  {
    id: uid(),
    user_id: 'local',
    name: 'Ideal Milk 320g',
    cost_price: 8.5,
    selling_price: 12.0,
    quantity: 24,
    unit: 'tin',
    category: 'Dairy',
    low_stock_threshold: 5,
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    name: 'Sugar 1kg',
    cost_price: 15.0,
    selling_price: 20.0,
    quantity: 18,
    unit: 'bag',
    category: 'Groceries',
    low_stock_threshold: 4,
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    name: 'Milo 400g',
    cost_price: 28.0,
    selling_price: 35.0,
    quantity: 12,
    unit: 'tin',
    category: 'Beverages',
    low_stock_threshold: 3,
    created_at: new Date(Date.now() - 6 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    name: 'Sunflower Oil 1L',
    cost_price: 22.0,
    selling_price: 28.0,
    quantity: 15,
    unit: 'bottle',
    category: 'Cooking',
    low_stock_threshold: 4,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    name: 'Rice 5kg',
    cost_price: 45.0,
    selling_price: 55.0,
    quantity: 10,
    unit: 'bag',
    category: 'Grains',
    low_stock_threshold: 3,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    name: 'Tin Tomatoes 400g',
    cost_price: 6.5,
    selling_price: 9.0,
    quantity: 30,
    unit: 'tin',
    category: 'Canned',
    low_stock_threshold: 6,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    name: 'Indomie Noodles',
    cost_price: 3.5,
    selling_price: 5.0,
    quantity: 48,
    unit: 'pack',
    category: 'Noodles',
    low_stock_threshold: 10,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    name: 'Bread',
    cost_price: 8.0,
    selling_price: 11.0,
    quantity: 20,
    unit: 'loaf',
    category: 'Bakery',
    low_stock_threshold: 5,
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
] as Product[]

const seedSales: Sale[] = [
  {
    id: uid(),
    user_id: 'local',
    product_id: seedProducts[0].id,
    product_name: 'Ideal Milk 320g',
    quantity: 2,
    unit_price: 12.0,
    total: 24.0,
    profit: 7.0,
    customer_name: null,
    customer_phone: null,
    payment_method: 'cash',
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    product_id: seedProducts[1].id,
    product_name: 'Sugar 1kg',
    quantity: 1,
    unit_price: 20.0,
    total: 20.0,
    profit: 5.0,
    customer_name: 'Auntie Yaa',
    customer_phone: '0244123456',
    payment_method: 'momo',
    created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    product_id: seedProducts[2].id,
    product_name: 'Milo 400g',
    quantity: 1,
    unit_price: 35.0,
    total: 35.0,
    profit: 7.0,
    customer_name: null,
    customer_phone: null,
    payment_method: 'cash',
    created_at: new Date(Date.now() - 4 * 3600000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    product_id: seedProducts[3].id,
    product_name: 'Sunflower Oil 1L',
    quantity: 3,
    unit_price: 28.0,
    total: 84.0,
    profit: 18.0,
    customer_name: 'Mr. Kwasi',
    customer_phone: '0555123456',
    payment_method: 'cash',
    created_at: new Date(Date.now() - 5 * 3600000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    product_id: seedProducts[4].id,
    product_name: 'Rice 5kg',
    quantity: 1,
    unit_price: 55.0,
    total: 55.0,
    profit: 10.0,
    customer_name: null,
    customer_phone: null,
    payment_method: 'cash',
    created_at: new Date(Date.now() - 6 * 3600000).toISOString(),
  },
] as Sale[]

const seedDebts: Debt[] = [
  {
    id: uid(),
    user_id: 'local',
    person_name: 'Auntie Yaa',
    phone: '0244123456',
    amount: 45.0,
    description: 'Milo and sugar - partial payment',
    type: 'owed',
    due_date: new Date(Date.now() + 3 * 86400000).toISOString(),
    is_paid: false,
    paid_at: null,
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    person_name: 'Mr. Kwasi',
    phone: '0555123456',
    amount: 75.0,
    description: 'Rice and oil delivery',
    type: 'owed',
    due_date: new Date(Date.now() + 5 * 86400000).toISOString(),
    is_paid: false,
    paid_at: null,
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    person_name: 'Supplier Kofi',
    phone: '0202123456',
    amount: 200.0,
    description: 'Stock advance payment',
    type: 'owing',
    due_date: new Date(Date.now() + 7 * 86400000).toISOString(),
    is_paid: false,
    paid_at: null,
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
] as Debt[]

const seedExpenses: Expense[] = [
  {
    id: uid(),
    user_id: 'local',
    name: 'Market toll',
    amount: 5.0,
    category: 'Toll',
    created_at: new Date(Date.now() - 8 * 3600000).toISOString(),
  },
  {
    id: uid(),
    user_id: 'local',
    name: 'Transport to Makola',
    amount: 15.0,
    category: 'Transport',
    created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
]

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
