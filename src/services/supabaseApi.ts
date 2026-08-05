// ============================================
// SUPABASE API — Properly Multi-Tenant
// Every fetch is scoped to the authenticated user
// ============================================
import { supabase } from '@/lib/supabase'
import type { Product, Sale, Debt, Expense, Customer } from '@/lib/supabase'
import { consumeForSale, reverseConsumptions } from '@/services/batchApi'
import { resolveScopeId } from '@/services/scopeId'
import type { Role } from '@/lib/permissions'

// Get the real Supabase user UUID — this is the tenant key
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser()
    const uid = data.user?.id ?? null
    if (!uid) return null
    const { data: businessId, error } = await supabase.rpc('business_id_for', { uid })
    return resolveScopeId(uid, (businessId as string) ?? null, !!error)
  } catch {
    return null
  }
}

// ============================================
// PRODUCTS (scoped to user)
// ============================================
// Staff never receives cost_price from the server. This was originally an
// app-layer-only control (a narrower .select() column list) — found live in
// production testing to be trivially bypassed by any caller issuing their
// own REST call with select=*, since RLS is row-scoped, not column-scoped,
// and never actually restricted this column. migration_033 closes that:
// REVOKEs SELECT on products.cost_price from `authenticated` entirely (no
// app role can read it via a direct table query anymore) and this RPC is
// the only sanctioned read path — it's SECURITY DEFINER, so it isn't
// subject to that revoke, and applies the real role-based masking itself.
export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase.rpc('get_products')
  if (error) throw error
  return (data as unknown as Product[]) || []
}

// Every Product column except cost_price — migration_033 revokes SELECT on
// that column for `authenticated` entirely, so an unqualified .select()
// (implicit select=*) after insert/update now fails for EVERY caller, not
// just Staff. The caller already knows the cost_price they just sent (they
// typed it in, or it's unchanged from what they already had), so it's
// merged back into the returned object below instead of round-tripping a
// read the database will no longer allow.
const PRODUCT_COLUMNS_SANS_COST: string =
  'id, user_id, name, selling_price, quantity, unit, pack_unit, units_per_pack, category, low_stock_threshold, barcode, qr_code, created_at, updated_at'

export async function insertProduct(product: Omit<Product, 'user_id'>): Promise<Product> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('products')
    .insert({ ...product, user_id: uid })
    .select(PRODUCT_COLUMNS_SANS_COST)
    .single()

  if (error) throw error
  return { ...(data as unknown as Product), cost_price: product.cost_price }
}

export async function updateProductDb(id: string, updates: Partial<Product>): Promise<Product> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .eq('user_id', uid) // ensure tenant isolation
    .select(PRODUCT_COLUMNS_SANS_COST)
    .single()

  if (error) throw error
  // updates.cost_price is only present when the caller is actually changing
  // it (e.g. re-stocking at a new unit cost) — when absent, callers already
  // hold the pre-update value in state.products and merge it themselves.
  return { ...(data as unknown as Product), cost_price: updates.cost_price ?? 0 }
}

export async function deleteProductDb(id: string): Promise<void> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .eq('user_id', uid) // ensure tenant isolation
    .select('id')

  if (error) throw error
  // A delete blocked by RLS returns 0 rows and NO error — same pattern already
  // fixed for debts/sales (migration_004/018's original bug). Now that DELETE
  // on products is owner-only (migration_030), a Manager/Staff caller hits
  // exactly this silently-blocked case, and the caller (removeProduct in
  // store.tsx) needs a real error to react to instead of a lie.
  if (!data || data.length === 0) {
    throw new Error('Product not deleted — no rows affected (check RLS delete policy).')
  }
}

// ============================================
// SALES (scoped to user, auto-reduce stock)
// ============================================
// Staff never receives sales.profit. Same history as fetchProducts()'s
// cost_price exclusion above — was an app-layer-only narrower .select(),
// found live in production RBAC testing to be trivially bypassable via a
// raw REST call with select=*, since RLS is row-scoped, not column-scoped.
// migration_033's get_sales() RPC is SECURITY DEFINER (unaffected by the
// REVOKE SELECT (profit) it also adds to `authenticated`) and applies the
// real masking server-side instead.
export async function fetchSales(): Promise<Sale[]> {
  const { data, error } = await supabase.rpc('get_sales')
  if (error) throw error
  return (data as unknown as Sale[]) || []
}

// Every Sale column except profit — same reasoning as PRODUCT_COLUMNS_SANS_COST:
// migration_033 revokes SELECT on sales.profit for `authenticated`, so an
// unqualified .select() after insert/update now fails for EVERY caller. The
// caller already knows the profit value it just sent/computed, so it's
// merged back locally instead of read back from the (now-forbidden) column.
const SALE_COLUMNS_SANS_PROFIT: string =
  'id, user_id, product_id, product_name, quantity, unit_price, sale_unit, sale_unit_qty, total, customer_name, customer_phone, payment_method, qr_invoice, sale_group_id, created_at'

export async function recordSale(
  sale: Omit<Sale, 'user_id'>,
  productId: string,
  quantitySold: number
): Promise<Sale> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  // Insert sale scoped to user
  const { data: saleRow, error: saleError } = await supabase
    .from('sales')
    .insert({ ...sale, user_id: uid })
    .select(SALE_COLUMNS_SANS_PROFIT)
    .single()

  if (saleError) throw saleError
  const saleData = { ...(saleRow as unknown as Sale), profit: sale.profit }

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
      const { error: fixError } = await supabase
        .from('sales').update({ profit: trueProfit }).eq('id', saleData.id).eq('user_id', uid)
      if (!fixError) return { ...saleData, profit: trueProfit }
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
  const { data: saleRows, error: saleError } = await supabase
    .from('sales')
    .insert(sales.map((s) => ({ ...s, user_id: uid })))
    .select(SALE_COLUMNS_SANS_PROFIT)

  if (saleError) throw saleError

  // Merge back each row's caller-provided profit (order-preserving insert) —
  // profit is no longer readable via the .select() above post-migration_033.
  const inserted = ((saleRows as unknown as Sale[]) || []).map((row, i) => ({
    ...row,
    profit: sales[i]?.profit ?? 0,
  }))
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

  // Restore batch stock and drop this sale's consumption rows.
  await reverseConsumptions(ids)

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

  // If any of these sales were on credit, remove the linked customer tab(s).
  const groupIds = Array.from(new Set(sales.map((s) => s.sale_group_id).filter(Boolean))) as string[]
  if (groupIds.length) {
    await supabase.from('debts').delete().in('sale_group_id', groupIds).eq('user_id', uid)
    const { deleteMovementsByRef } = await import('@/services/cashApi')
    for (const g of groupIds) await deleteMovementsByRef('sales', g)
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

export async function deleteDebtDb(id: string): Promise<void> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('debts')
    .delete()
    .eq('id', id)
    .eq('user_id', uid)
    .select('id')

  if (error) throw error
  // A delete blocked by RLS returns 0 rows and NO error. Treat that as failure so
  // callers don't fake success (the bug that made debt deletes "not persist").
  if (!data || data.length === 0) {
    throw new Error('Debt not deleted — no rows affected (check RLS delete policy).')
  }
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
export async function getDashboardSummary(role?: Role | null): Promise<{
  totalSales: number
  totalProfit: number
  totalExpenses: number
  todaySales: number
  todayProfit: number
  pendingDebts: number
  owingDebts: number
  creditSalesOutstanding: number
  cashInHand: number
  cashInBank: number
  stockValue: number
  projectedProfit: number
}> {
  const uid = await getCurrentUserId()
  if (!uid) {
    return { totalSales: 0, totalProfit: 0, totalExpenses: 0, todaySales: 0, todayProfit: 0, pendingDebts: 0, owingDebts: 0, creditSalesOutstanding: 0, cashInHand: 0, cashInBank: 0, stockValue: 0, projectedProfit: 0 }
  }

  const todayStart = new Date().toISOString().split('T')[0] + 'T00:00:00'

  // sales.profit/products.cost_price now come back already masked (0) for
  // Staff straight from the get_sales()/get_products() RPCs (migration_033
  // — SECURITY DEFINER, applies the real server-side masking, not just a
  // narrower client-requested column list). But a masked cost_price of 0
  // doesn't make DERIVED formulas below (e.g. selling_price - cost_price)
  // come out to 0 on its own — it makes them compute full revenue as if it
  // were pure profit, the same bug this isStaff guard exists to prevent.
  // Still needed even though the raw fields are safe now.
  const isStaff = role === 'staff'
  const [salesRes, expensesRes, debtsRes, productsRes] = await Promise.all([
    supabase.rpc('get_sales'),
    supabase.from('expenses').select('amount').eq('user_id', uid),
    supabase.from('debts').select('amount, amount_paid, type, is_paid, sale_group_id').eq('user_id', uid),
    supabase.rpc('get_products'),
  ])

  const sales = (salesRes.data as unknown as Record<string, string | number>[]) || []
  const expenses = expensesRes.data || []
  const debts = debtsRes.data || []
  const products = (productsRes.data as unknown as Record<string, number>[]) || []

  const totalSales = sales.reduce((s: number, sale: Record<string, string | number>) => s + (Number(sale.total) || 0), 0)
  // Explicitly 0 for staff rather than relying on the missing column to
  // degrade the arithmetic — same reasoning as stockValue/projectedProfit
  // above: `(sale.profit || 0)` would already yield 0 once the field is
  // absent, but stating it directly makes the intent unambiguous.
  const totalProfit = isStaff ? 0 : sales.reduce((s: number, sale: Record<string, string | number>) => s + (Number(sale.profit) || 0), 0)
  const totalExpenses = expenses.reduce((s: number, e: Record<string, number>) => s + (e.amount || 0), 0)
  const todaySales = sales.filter((s: Record<string, string | number>) => (s.created_at as string) >= todayStart).reduce((sum: number, s: Record<string, string | number>) => sum + (Number(s.total) || 0), 0)
  const todayProfit = isStaff ? 0 : sales.filter((s: Record<string, string | number>) => (s.created_at as string) >= todayStart).reduce((sum: number, s: Record<string, string | number>) => sum + (Number(s.profit) || 0), 0)
  const debtRemaining = (d: Record<string, number>) => Math.max(0, (d.amount || 0) - (d.amount_paid || 0))
  const pendingDebts = debts.filter((d: Record<string, unknown>) => d.type === 'owed' && !d.is_paid).reduce((sum: number, d: Record<string, number>) => sum + debtRemaining(d), 0)
  const owingDebts = debts.filter((d: Record<string, unknown>) => d.type === 'owing' && !d.is_paid).reduce((sum: number, d: Record<string, number>) => sum + debtRemaining(d), 0)
  // Unpaid portion of CREDIT SALES only (debts linked to a sale via sale_group_id).
  // These inflate totalSales by the full cart value though only the deposit is cash
  // in hand, so the remainder is subtracted from cash. Manual owed debts never hit
  // the sales table, so they must NOT be subtracted here.
  const creditSalesOutstanding = debts
    .filter((d: Record<string, unknown>) => d.type === 'owed' && !d.is_paid && d.sale_group_id)
    .reduce((sum: number, d: Record<string, number>) => sum + debtRemaining(d), 0)
  // Cash now comes from the ledger (source of truth), not a derived formula.
  let cashInHand = totalSales - totalExpenses - creditSalesOutstanding // fallback
  let cashInBank = 0
  try {
    const { fetchBalances } = await import('@/services/cashApi')
    const bal = await fetchBalances()
    cashInHand = bal.cash
    cashInBank = bal.bank
  } catch { /* ledger unavailable (pre-migration / offline) — keep fallback */ }
  // Explicitly 0 for staff rather than relying on the formula to degrade:
  // stockValue's single cost_price term naturally zeroes when the field is
  // absent, but projectedProfit's (selling_price - cost_price) only loses
  // its cost_price term, leaving total revenue behind — not the intended 0.
  const stockValue = isStaff ? 0 : products.reduce((sum: number, p: Record<string, number>) => sum + (p.cost_price || 0) * (p.quantity || 0), 0)
  const projectedProfit = isStaff ? 0 : products.reduce((sum: number, p: Record<string, number>) => sum + ((p.selling_price || 0) - (p.cost_price || 0)) * (p.quantity || 0), 0)

  return { totalSales, totalProfit, totalExpenses, todaySales, todayProfit, pendingDebts, owingDebts, creditSalesOutstanding, cashInHand, cashInBank, stockValue, projectedProfit }
}

// ============================================
// BUSINESS PROFILE (scoped to user)
// ============================================
export type BusinessProfileResult =
  | { status: 'found'; profile: any }
  | { status: 'missing' }
  | { status: 'error' }

// Staff can't read business_profiles at all (migration_027 restricts SELECT
// to owner/manager) so fetchBusinessProfile() below always returns 'missing'
// for them — this is the narrow fallback that gives them just their
// employer's business name (not the rest of the profile) for display,
// via the SECURITY DEFINER business_name_for() (migration_032). Found live:
// without this, Dashboard's header fell back to a hardcoded placeholder
// name for every Staff account, permanently.
export async function fetchBusinessName(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data, error } = await supabase.rpc('business_name_for', { uid: user.id })
    if (error) return null
    return (data as string) || null
  } catch {
    return null
  }
}

// Distinguishes "no profile row exists" (status: 'missing') from a transient
// fetch failure (status: 'error') — callers that need to gate onboarding UI on
// a genuinely-missing profile (not just an errored fetch) depend on this
// distinction. See docs/superpowers/plans/2026-08-03-multi-industry-categories-plan.md
// Task 7 / final-review fix wave.
export async function fetchBusinessProfile(): Promise<BusinessProfileResult> {
  const uid = await getCurrentUserId()
  if (!uid) return { status: 'error' }

  try {
    const { data, error } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('user_id', uid)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return { status: 'missing' }
      console.warn('Supabase business_profiles error:', error.message)
      return { status: 'error' }
    }
    return { status: 'found', profile: data }
  } catch (err) {
    console.warn('fetchBusinessProfile catch:', err)
    return { status: 'error' }
  }
}

// Deliberately NOT .upsert(): supabase-js sends upsert as
// `Prefer: resolution=merge-duplicates`, i.e. INSERT ... ON CONFLICT DO
// UPDATE. Found in live production testing: for a brand-new signup with
// zero existing rows, this consistently 403'd with "new row violates
// row-level security policy" even though the INSERT policy's WITH CHECK
// (and, after patching, the UPDATE policy's USING) independently verified
// true — proven both by literal-value SQL tests and by a debug trigger
// that computed every condition live inside the real request and printed
// all-true. Disabling RLS made the exact same request succeed, confirming
// the block was genuinely coming from RLS's interaction with the
// ON-CONFLICT-DO-UPDATE statement shape, not the policy logic itself.
// Doing an explicit existence check + plain insert/update avoids that
// interaction entirely: a plain INSERT only ever needs the INSERT policy,
// a plain UPDATE only ever needs the UPDATE policy — no combined-statement
// ambiguity for Postgres to resolve.
export async function upsertBusinessProfile(profile: any): Promise<any> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  const { data: existing } = await supabase
    .from('business_profiles')
    .select('id')
    .eq('user_id', uid)
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from('business_profiles')
      .update({ ...profile, user_id: uid })
      .eq('user_id', uid)
      .select()
      .single()
    if (error) throw error
    return data
  }

  const { data, error } = await supabase
    .from('business_profiles')
    .insert({ ...profile, user_id: uid })
    .select()
    .single()

  if (error) throw error
  return data
}

// ============================================
// RESET DATA (scoped to user)
// ============================================
// role is app-layer defense in depth for a clear, immediate error — the real
// enforcement is the DB-layer DELETE policies (migration_030), which reject
// a non-owner's delete regardless of this check. getCurrentUserId() now
// resolves to the OWNER's business id even when called by an active
// Staff/Manager account, so the old "RLS scopes by user_id alone" comment
// this function carried is no longer sufficient on its own — a staff/manager
// caller's uid would resolve to the SAME id an owner's delete would use.
export async function resetAllUserData(role?: Role | null): Promise<void> {
  // Was `if (role && role !== 'owner')` — short-circuited past a null/undefined
  // role (the transient state during initial role resolution, see store.tsx's
  // roleResolved) and let the call through unchecked. This function is the
  // app-layer half of C3's defense-in-depth; migration_030 is what actually
  // enforces it, but the app-layer check should fail closed too, not just for
  // known non-owners. Found in the RBAC feature's final whole-branch review,
  // fix-wave re-review round 2.
  if (role !== 'owner') throw new Error('Only the business owner can reset all data')
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  // Row deletion is scoped by user_id AND (as of migration_030) restricted to
  // the owner at the RLS layer — a non-owner's delete affects 0 rows.
  await Promise.all([
    supabase.from('sales').delete().eq('user_id', uid),
    supabase.from('products').delete().eq('user_id', uid),
    supabase.from('debts').delete().eq('user_id', uid),
    supabase.from('expenses').delete().eq('user_id', uid),
    supabase.from('customers').delete().eq('user_id', uid),
  ])
}
