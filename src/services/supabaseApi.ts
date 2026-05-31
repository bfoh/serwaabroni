// ============================================
// SUPABASE API — Properly Multi-Tenant
// Every fetch is scoped to the authenticated user
// ============================================
import { supabase } from '@/lib/supabase'
import type { Product, Sale, Debt, Expense, Customer } from '@/lib/supabase'

// Get the real Supabase user UUID — this is the tenant key
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser()
    return data.user?.id ?? null
  } catch {
    return null
  }
}

// ============================================
// PRODUCTS (scoped to user)
// ============================================
export async function fetchProducts(): Promise<Product[]> {
  const uid = await getCurrentUserId()
  if (!uid) return []

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as Product[]) || []
}

export async function insertProduct(product: Omit<Product, 'user_id'>): Promise<Product> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('products')
    .insert({ ...product, user_id: uid })
    .select()
    .single()

  if (error) throw error
  return data as Product
}

export async function updateProductDb(id: string, updates: Partial<Product>): Promise<Product> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .eq('user_id', uid) // ensure tenant isolation
    .select()
    .single()

  if (error) throw error
  return data as Product
}

export async function deleteProductDb(id: string): Promise<void> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .eq('user_id', uid) // ensure tenant isolation

  if (error) throw error
}

// ============================================
// SALES (scoped to user, auto-reduce stock)
// ============================================
export async function fetchSales(): Promise<Sale[]> {
  const uid = await getCurrentUserId()
  if (!uid) return []

  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error
  return (data as Sale[]) || []
}

export async function recordSale(
  sale: Omit<Sale, 'user_id'>,
  productId: string,
  quantitySold: number
): Promise<Sale> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  // Insert sale scoped to user
  const { data: saleData, error: saleError } = await supabase
    .from('sales')
    .insert({ ...sale, user_id: uid })
    .select()
    .single()

  if (saleError) throw saleError

  // Reduce stock — scoped to user's own product
  if (productId) {
    const { data: product } = await supabase
      .from('products')
      .select('quantity')
      .eq('id', productId)
      .eq('user_id', uid)
      .single()

    if (product) {
      const newQty = Math.max(0, (product.quantity || 0) - quantitySold)
      await supabase
        .from('products')
        .update({ quantity: newQty })
        .eq('id', productId)
        .eq('user_id', uid)
    }
  }

  return saleData as Sale
}

// ============================================
// DEBTS (scoped to user)
// ============================================
export async function fetchDebts(): Promise<Debt[]> {
  const uid = await getCurrentUserId()
  if (!uid) return []

  const { data, error } = await supabase
    .from('debts')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as Debt[]) || []
}

export async function insertDebt(debt: Omit<Debt, 'user_id'>): Promise<Debt> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('debts')
    .insert({ ...debt, user_id: uid })
    .select()
    .single()

  if (error) throw error
  return data as Debt
}

export async function updateDebtDb(id: string, updates: Partial<Debt>): Promise<Debt> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('debts')
    .update(updates)
    .eq('id', id)
    .eq('user_id', uid)
    .select()
    .single()

  if (error) throw error
  return data as Debt
}

// ============================================
// EXPENSES (scoped to user)
// ============================================
export async function fetchExpenses(): Promise<Expense[]> {
  const uid = await getCurrentUserId()
  if (!uid) return []

  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as Expense[]) || []
}

export async function insertExpense(expense: Omit<Expense, 'user_id'>): Promise<Expense> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('expenses')
    .insert({ ...expense, user_id: uid })
    .select()
    .single()

  if (error) throw error
  return data as Expense
}

export async function deleteExpenseDb(id: string): Promise<void> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id)
    .eq('user_id', uid)

  if (error) throw error
}

// ============================================
// CUSTOMERS (scoped to user)
// ============================================
export async function fetchCustomers(): Promise<Customer[]> {
  const uid = await getCurrentUserId()
  if (!uid) return []

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('user_id', uid)
    .order('name', { ascending: true })

  if (error) throw error
  return (data as Customer[]) || []
}

export async function insertCustomer(customer: Omit<Customer, 'user_id'>): Promise<Customer> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('customers')
    .insert({ ...customer, user_id: uid })
    .select()
    .single()

  if (error) throw error
  return data as Customer
}

export async function updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .eq('user_id', uid)
    .select()
    .single()

  if (error) throw error
  return data as Customer
}

// ============================================
// DASHBOARD SUMMARY (scoped to user)
// ============================================
export async function getDashboardSummary(): Promise<{
  totalSales: number
  totalProfit: number
  totalExpenses: number
  todaySales: number
  todayProfit: number
  pendingDebts: number
  owingDebts: number
  stockValue: number
  projectedProfit: number
}> {
  const uid = await getCurrentUserId()
  if (!uid) {
    return { totalSales: 0, totalProfit: 0, totalExpenses: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0, owingDebts: 0, stockValue: 0, projectedProfit: 0 }
  }

  const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00'

  const [salesRes, expensesRes, debtsRes, productsRes] = await Promise.all([
    supabase.from('sales').select('total, profit, created_at').eq('user_id', uid),
    supabase.from('expenses').select('amount').eq('user_id', uid),
    supabase.from('debts').select('amount, type, is_paid').eq('user_id', uid),
    supabase.from('products').select('cost_price, selling_price, quantity').eq('user_id', uid),
  ])

  const sales = salesRes.data || []
  const expenses = expensesRes.data || []
  const debts = debtsRes.data || []
  const products = productsRes.data || []

  const totalSales = sales.reduce((s: number, sale: Record<string, number>) => s + (sale.total || 0), 0)
  const totalProfit = sales.reduce((s: number, sale: Record<string, number>) => s + (sale.profit || 0), 0)
  const totalExpenses = expenses.reduce((s: number, e: Record<string, number>) => s + (e.amount || 0), 0)
  const todaySales = sales.filter((s: Record<string, string>) => s.created_at >= todayStart).reduce((sum: number, s: Record<string, number>) => sum + (s.total || 0), 0)
  const todayProfit = sales.filter((s: Record<string, string>) => s.created_at >= todayStart).reduce((sum: number, s: Record<string, number>) => sum + (s.profit || 0), 0)
  const pendingDebts = debts.filter((d: Record<string, unknown>) => d.type === 'owed' && !d.is_paid).reduce((sum: number, d: Record<string, number>) => sum + (d.amount || 0), 0)
  const owingDebts = debts.filter((d: Record<string, unknown>) => d.type === 'owing' && !d.is_paid).reduce((sum: number, d: Record<string, number>) => sum + (d.amount || 0), 0)
  const stockValue = products.reduce((sum: number, p: Record<string, number>) => sum + (p.cost_price || 0) * (p.quantity || 0), 0)
  const projectedProfit = products.reduce((sum: number, p: Record<string, number>) => sum + ((p.selling_price || 0) - (p.cost_price || 0)) * (p.quantity || 0), 0)

  return { totalSales, totalProfit, totalExpenses, todaySales, todayProfit, pendingDebts, owingDebts, stockValue, projectedProfit }
}

// ============================================
// BUSINESS PROFILE (scoped to user)
// ============================================
export async function fetchBusinessProfile(): Promise<any> {
  const uid = await getCurrentUserId()
  if (!uid) return null

  try {
    const { data, error } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('user_id', uid)
      .single()

    if (error) {
      console.warn('Supabase business_profiles error:', error.message)
      return null
    }
    return data
  } catch (err) {
    console.warn('fetchBusinessProfile catch:', err)
    return null
  }
}

export async function upsertBusinessProfile(profile: any): Promise<any> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('business_profiles')
    .upsert({ ...profile, user_id: uid })
    .select()
    .single()

  if (error) throw error
  return data
}

// ============================================
// RESET DATA (scoped to user)
// ============================================
export async function resetAllUserData(): Promise<void> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  // Due to RLS, we can just blindly delete all rows matching user_id
  await Promise.all([
    supabase.from('sales').delete().eq('user_id', uid),
    supabase.from('products').delete().eq('user_id', uid),
    supabase.from('debts').delete().eq('user_id', uid),
    supabase.from('expenses').delete().eq('user_id', uid),
    supabase.from('customers').delete().eq('user_id', uid),
  ])
}
