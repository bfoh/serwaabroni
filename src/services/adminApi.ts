// ============================================
// ADMIN API — platform-owner operations.
// All authority is enforced in Postgres; these are thin RPC wrappers.
// ============================================
import { supabase } from '@/lib/supabase'
import type { Sale, Expense } from '@/lib/supabase'

export interface PlatformSummary {
  tenant_count: number
  active_count: number
  suspended_count: number
  gross_revenue: number
  total_profit: number
  total_expenses: number
}

export interface TenantRow {
  user_id: string
  email: string
  business_name: string
  status: 'active' | 'suspended'
  created_at: string
  total_sales: number
  total_profit: number
  total_expenses: number
  sale_count: number
  last_activity: string | null
}

export interface TenantDetail {
  sales: Sale[]
  expenses: Expense[]
  totalSales: number
  totalProfit: number
  totalExpenses: number
}

export async function amISuperAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('am_i_super_admin')
  if (error) return false
  return data === true
}

export async function getPlatformSummary(): Promise<PlatformSummary | null> {
  const { data, error } = await supabase.rpc('admin_platform_summary')
  if (error) throw error
  // RETURNS TABLE -> array with a single row
  return (Array.isArray(data) ? data[0] : data) ?? null
}

export async function listTenants(): Promise<TenantRow[]> {
  const { data, error } = await supabase.rpc('admin_list_tenants')
  if (error) throw error
  return (data as TenantRow[]) ?? []
}

export async function setTenantStatus(
  userId: string,
  status: 'active' | 'suspended',
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_tenant_status', {
    p_user_id: userId,
    p_status: status,
    p_reason: reason,
  })
  if (error) throw error
}

export async function deleteTenant(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_tenant', { p_user_id: userId })
  if (error) throw error
}

// Read-only drill-in. Allowed by the admin SELECT RLS policies added in migration_005.
export async function getTenantDetail(userId: string): Promise<TenantDetail> {
  const [salesRes, expensesRes] = await Promise.all([
    supabase.from('sales').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase.from('expenses').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ])
  const sales = (salesRes.data as Sale[]) ?? []
  const expenses = (expensesRes.data as Expense[]) ?? []
  return {
    sales,
    expenses,
    totalSales: sales.reduce((s, x) => s + (x.total || 0), 0),
    totalProfit: sales.reduce((s, x) => s + (x.profit || 0), 0),
    totalExpenses: expenses.reduce((s, x) => s + (x.amount || 0), 0),
  }
}

// ============================================
// IMPERSONATION — act as a tenant (full read+write) via a minted session.
// ============================================
export const ADMIN_BACKUP_KEY = 'sb-admin-backup'

export interface AdminBackup {
  access_token: string
  refresh_token: string
  tenantName: string
}

// Pure parser so it is unit-testable without a DOM/localStorage.
export function parseAdminBackup(raw: string | null): AdminBackup | null {
  if (!raw) return null
  try {
    const b = JSON.parse(raw)
    if (
      b && typeof b.access_token === 'string' &&
      typeof b.refresh_token === 'string' &&
      typeof b.tenantName === 'string'
    ) return b as AdminBackup
    return null
  } catch {
    return null
  }
}

export function readAdminBackup(): AdminBackup | null {
  try { return parseAdminBackup(localStorage.getItem(ADMIN_BACKUP_KEY)) } catch { return null }
}

// Save the current (admin) session, mint a tenant session, and swap to it.
export async function impersonateTenant(tenantId: string, tenantName: string): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const s = sess.session
  if (!s) throw new Error('No admin session')
  localStorage.setItem(ADMIN_BACKUP_KEY, JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token, tenantName,
  }))
  try {
    const { data, error } = await supabase.functions.invoke('admin-impersonate', { body: { tenantId } })
    if (error) throw error
    const token_hash = (data as { token_hash?: string })?.token_hash
    if (!token_hash) throw new Error('No token returned')
    const { error: vErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash })
    if (vErr) throw vErr
  } catch (e) {
    localStorage.removeItem(ADMIN_BACKUP_KEY)  // admin session still active
    throw e
  }
}

// Restore the saved admin session and log the stop event.
export async function stopImpersonation(): Promise<void> {
  const backup = readAdminBackup()
  if (!backup) return
  try { await supabase.rpc('admin_log_impersonation_stop') } catch { /* best effort */ }
  const { error } = await supabase.auth.setSession({
    access_token: backup.access_token, refresh_token: backup.refresh_token,
  })
  if (error) throw error
  localStorage.removeItem(ADMIN_BACKUP_KEY)
}
