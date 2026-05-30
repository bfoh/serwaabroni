import { supabase } from '@/lib/supabase'
import type { Product, Sale, Debt, Expense, BusinessProfile } from '@/lib/supabase'

// ============================================
// AUTH SERVICES
// ============================================

export async function signInWithPhone(phone: string) {
  const { data, error } = await supabase.auth.signInWithOtp({
    phone,
    options: {
      channel: 'sms',
    },
  })
  return { data, error }
}

export async function verifyPhoneOTP(phone: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  })
  return { data, error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  return { user, error }
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  return { session, error }
}

// ============================================
// PRODUCT SERVICES
// ============================================

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function insertProduct(product: Omit<Product, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<Product> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('products')
    .insert({ ...product, user_id: user.id })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateProduct(id: string, updates: Partial<Product>): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ============================================
// SALE SERVICES
// ============================================

export async function fetchSales(limit = 100): Promise<Sale[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data || []
}

export async function fetchSalesByPeriod(startDate: string, endDate: string): Promise<Sale[]> {
  const { data, error } = await supabase
    .from('sales')
    .select('*')
    .gte('created_at', startDate)
    .lte('created_at', endDate)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function insertSale(sale: Omit<Sale, 'id' | 'user_id' | 'created_at'>): Promise<Sale> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('sales')
    .insert({ ...sale, user_id: user.id })
    .select()
    .single()

  if (error) throw error
  return data
}

// ============================================
// DEBT SERVICES
// ============================================

export async function fetchDebts(): Promise<Debt[]> {
  const { data, error } = await supabase
    .from('debts')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function insertDebt(debt: Omit<Debt, 'id' | 'user_id' | 'created_at'>): Promise<Debt> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('debts')
    .insert({ ...debt, user_id: user.id })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateDebt(id: string, updates: Partial<Debt>): Promise<Debt> {
  const { data, error } = await supabase
    .from('debts')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

// ============================================
// EXPENSE SERVICES
// ============================================

export async function fetchExpenses(): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function insertExpense(expense: Omit<Expense, 'id' | 'user_id' | 'created_at'>): Promise<Expense> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('expenses')
    .insert({ ...expense, user_id: user.id })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ============================================
// BUSINESS PROFILE SERVICES
// ============================================

export async function fetchBusinessProfile(): Promise<BusinessProfile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function upsertBusinessProfile(profile: Partial<BusinessProfile>): Promise<BusinessProfile> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('business_profiles')
    .upsert({ ...profile, user_id: user.id })
    .select()
    .single()

  if (error) throw error
  return data
}

// ============================================
// DASHBOARD SUMMARY
// ============================================

export interface DashboardSummary {
  total_balance: number
  today_sales: number
  pending_debts: number
  total_products: number
  low_stock_items: number
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { total_balance: 0, today_sales: 0, pending_debts: 0, total_products: 0, low_stock_items: 0 }
  }

  const { data, error } = await supabase
    .rpc('get_dashboard_summary', { user_uuid: user.id })

  if (error) throw error
  return data?.[0] || { total_balance: 0, today_sales: 0, pending_debts: 0, total_products: 0, low_stock_items: 0 }
}

// ============================================
// REALTIME SUBSCRIPTIONS
// ============================================

export function subscribeToProducts(callback: (payload: { new: Product; old: Product | null; eventType: string }) => void) {
  return supabase
    .channel('products-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, (payload) => {
      callback({
        new: payload.new as Product,
        old: payload.old as Product | null,
        eventType: payload.eventType,
      })
    })
    .subscribe()
}

export function subscribeToSales(callback: (payload: { new: Sale; old: Sale | null; eventType: string }) => void) {
  return supabase
    .channel('sales-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
      callback({
        new: payload.new as Sale,
        old: payload.old as Sale | null,
        eventType: payload.eventType,
      })
    })
    .subscribe()
}

// ============================================
// BULK OPERATIONS (for offline sync)
// ============================================

export async function bulkInsertProducts(products: Omit<Product, 'id' | 'user_id' | 'created_at' | 'updated_at'>[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('products')
    .insert(products.map((p) => ({ ...p, user_id: user.id })))

  if (error) throw error
}

export async function bulkInsertSales(sales: Omit<Sale, 'id' | 'user_id' | 'created_at'>[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('sales')
    .insert(sales.map((s) => ({ ...s, user_id: user.id })))

  if (error) throw error
}
