// ============================================
// SUPABASE API — Properly Multi-Tenant
// Every fetch is scoped to the authenticated user
// ============================================
import { supabase } from '@/lib/supabase'
import type { Product, Sale, Debt, Expense, Customer } from '@/lib/supabase'
import { consumeForSale } from '@/services/batchApi'

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

  // Consume batches FIFO → writes consumption rows + decrements batch stock.
  // The sale's profit becomes the true sum of the draws (batch-accurate).
  if (productId) {
    const result = await consumeForSale({
      saleId: saleData.id,
      productId,
      quantity: quantitySold,
      unitPrice: sale.unit_price,
    })
    const trueProfit = result.draws.reduce((s, d) => s + d.profit, 0)
      + (result.untrackedQty > 0 ? Math.round(sale.unit_price * result.untrackedQty * 100) / 100 : 0)
    // Keep products.quantity cache in step with the batches.
    const { data: product } = await supabase
      .from('products').select('quantity').eq('id', productId).eq('user_id', uid).single()
    if (product) {
      await supabase
        .from('products')
        .update({ quantity: Math.max(0, (product.quantity || 0) - quantitySold) })
        .eq('id', productId).eq('user_id', uid)
    }
    if (trueProfit !== saleData.profit) {
      const { data: fixed } = await supabase
        .from('sales').update({ profit: trueProfit }).eq('id', saleData.id).eq('user_id', uid)
        .select().single()
      if (fixed) return fixed as Sale
    }
  }

  return saleData as Sale
}

// Record several sale rows in one checkout (a multi-product cart).
// Inserts all rows sharing the caller-provided customer/payment/timestamp,
// then decrements stock per product. Returns the inserted rows.
export async function recordSaleBatch(
  sales: Omit<Sale, 'user_id'>[],
  items: { productId: string; qty: number }[]
): Promise<Sale[]> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  // Insert all sale rows scoped to user
  const { data: saleData, error: saleError } = await supabase
    .from('sales')
    .insert(sales.map((s) => ({ ...s, user_id: uid })))
    .select()

  if (saleError) throw saleError

  // Map each inserted sale row to its product so we can attribute its profit.
  const inserted = (saleData as Sale[]) || []
  for (const { productId, qty } of items) {
    if (!productId) continue
    const saleRow = inserted.find((s) => s.product_id === productId)
    if (!saleRow) continue

    const result = await consumeForSale({
      saleId: saleRow.id,
      productId,
      quantity: qty,
      unitPrice: saleRow.unit_price,
    })
    const trueProfit = result.draws.reduce((s, d) => s + d.profit, 0)
      + (result.untrackedQty > 0 ? Math.round(saleRow.unit_price * result.untrackedQty * 100) / 100 : 0)

    const { data: product } = await supabase
      .from('products').select('quantity').eq('id', productId).eq('user_id', uid).single()
    if (product) {
      await supabase
        .from('products')
        .update({ quantity: Math.max(0, (product.quantity || 0) - qty) })
        .eq('id', productId).eq('user_id', uid)
    }
    if (trueProfit !== saleRow.profit) {
      await supabase.from('sales').update({ profit: trueProfit }).eq('id', saleRow.id).eq('user_id', uid)
      saleRow.profit = trueProfit
    }
  }

  return inserted
}

// Delete all sale rows of one Sales-History entry, restore the sold stock, and
// decrement the customer's lifetime total. Scoped to the current user.
export async function deleteSaleGroup(sales: Sale[]): Promise<void> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')
  if (sales.length === 0) return

  const ids = sales.map((s) => s.id)
  const { data: deleted, error: delError } = await supabase
    .from('sales')
    .delete()
    .in('id', ids)
    .eq('user_id', uid)
    .select('id')
  if (delError) throw delError
  // A delete blocked by RLS returns 0 rows and NO error. Treat that as failure
  // so callers don't fake success (the bug that made deletes "not persist").
  if (!deleted || deleted.length === 0) {
    throw new Error('Sale not deleted — no rows affected (check RLS delete policy).')
  }

  // Restore stock: sum the deleted quantity per product, add it back.
  // One read for all products, writes in parallel — avoids N serial round-trips.
  const qtyByProduct = new Map<string, number>()
  for (const s of sales) {
    if (!s.product_id) continue
    qtyByProduct.set(s.product_id, (qtyByProduct.get(s.product_id) || 0) + s.quantity)
  }
  if (qtyByProduct.size > 0) {
    const { data: products } = await supabase
      .from('products')
      .select('id, quantity')
      .in('id', Array.from(qtyByProduct.keys()))
      .eq('user_id', uid)
    await Promise.all(
      (products || []).map((product) =>
        supabase
          .from('products')
          .update({ quantity: (product.quantity || 0) + (qtyByProduct.get(product.id) || 0) })
          .eq('id', product.id)
          .eq('user_id', uid)
      )
    )
  }

  // Decrement the customer's lifetime total by the deleted sale total.
  const customerName = sales[0].customer_name
  if (customerName) {
    const groupTotal = sales.reduce((sum, s) => sum + (s.total || 0), 0)
    const { data: customers } = await supabase
      .from('customers')
      .select('id, total_purchases')
      .eq('user_id', uid)
      .ilike('name', customerName)
    const customer = customers?.[0]
    if (customer) {
      await supabase
        .from('customers')
        .update({ total_purchases: Math.max(0, (customer.total_purchases || 0) - groupTotal) })
        .eq('id', customer.id)
        .eq('user_id', uid)
    }
  }
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
    supabase.from('debts').select('amount, amount_paid, type, is_paid').eq('user_id', uid),
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
  const debtRemaining = (d: Record<string, number>) => Math.max(0, (d.amount || 0) - (d.amount_paid || 0))
  const pendingDebts = debts.filter((d: Record<string, unknown>) => d.type === 'owed' && !d.is_paid).reduce((sum: number, d: Record<string, number>) => sum + debtRemaining(d), 0)
  const owingDebts = debts.filter((d: Record<string, unknown>) => d.type === 'owing' && !d.is_paid).reduce((sum: number, d: Record<string, number>) => sum + debtRemaining(d), 0)
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
