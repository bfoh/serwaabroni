# Super Admin — Tenant Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform operator a gated, DB-enforced super-admin console to monitor every tenant (shop), drill into any tenant read-only, suspend/unsuspend tenants, and permanently delete tenants.

**Architecture:** All cross-tenant authority lives in Postgres (RLS + `SECURITY DEFINER` functions gated by `is_super_admin()`); the Vite SPA only names actions and renders results. Admin identity is a `super_admins` table. Suspension is enforced both by a frontend gate and by RLS write-blocks. No service-role key ships to the browser.

**Tech Stack:** Vite + React + TypeScript, Supabase (Postgres + RLS + RPC), react-router, existing `store` reducer + `supabaseApi` service layer. **No test runner exists in this repo** — verification is `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, plus the manual SQL/browser checks spelled out per task.

**Spec:** `docs/superpowers/specs/2026-06-03-super-admin-tenant-management-design.md`

---

## File Structure

- Create: `src/db/migration_005_super_admin.sql` — admin table, status columns, gate functions, admin SELECT policies, suspend write-blocks, admin RPCs, bootstrap snippet.
- Create: `src/services/adminApi.ts` — typed wrappers over the admin RPCs + drill-in reads.
- Modify: `src/lib/store.tsx` — add `isSuperAdmin` + `suspended` to state, `SET_SUPER_ADMIN` / `SET_SUSPENDED` actions, set both on load.
- Create: `src/pages/AdminConsole.tsx` — summary cards, tenant table, row actions, read-only drill-in.
- Create: `src/components/SuspendedScreen.tsx` — lockout screen for a suspended non-admin tenant.
- Modify: `src/App.tsx` — gated `/admin` route; render `SuspendedScreen` when suspended non-admin.
- Modify: `src/pages/Settings.tsx` — "Super Admin" menu entry shown only when `isSuperAdmin`.

---

## Task 1: Database migration

**Files:**
- Create: `src/db/migration_005_super_admin.sql`

- [ ] **Step 1: Write the migration file**

Create `src/db/migration_005_super_admin.sql` with exactly this content:

```sql
-- migration_005: super admin tenant management
-- Run AFTER migration_004. All admin authority is enforced here in Postgres.

-- ============================================================
-- 1. Admin registry (RLS on, no client policies => invisible to clients)
-- ============================================================
CREATE TABLE IF NOT EXISTS super_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. Tenant lifecycle columns on the per-shop record
-- ============================================================
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'active'
                                            CHECK (status IN ('active','suspended')),
  ADD COLUMN IF NOT EXISTS suspended_at     timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

-- ============================================================
-- 3. Gate functions
-- ============================================================
CREATE OR REPLACE FUNCTION is_super_admin(uid uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE user_id = uid);
$$;

CREATE OR REPLACE FUNCTION is_tenant_active(uid uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT status <> 'suspended' FROM business_profiles WHERE user_id = uid),
    true
  );
$$;

CREATE OR REPLACE FUNCTION am_i_super_admin()
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_super_admin(auth.uid());
$$;

-- ============================================================
-- 4. Admin read bypass (second permissive SELECT policy per table; OR'd)
-- ============================================================
CREATE POLICY "Super admin reads all products"
  ON products FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all sales"
  ON sales FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all debts"
  ON debts FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all expenses"
  ON expenses FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all customers"
  ON customers FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Super admin reads all business_profiles"
  ON business_profiles FOR SELECT USING (is_super_admin(auth.uid()));

-- ============================================================
-- 5. Suspend enforcement: recreate owner WRITE policies to require active tenant
--    (reads left intact; suspended tenant can view but not mutate)
-- ============================================================
-- products
DROP POLICY IF EXISTS "Users can insert own products" ON products;
CREATE POLICY "Users can insert own products" ON products
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own products" ON products;
CREATE POLICY "Users can update own products" ON products
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own products" ON products;
CREATE POLICY "Users can delete own products" ON products
  FOR DELETE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- sales
DROP POLICY IF EXISTS "Users can insert own sales" ON sales;
CREATE POLICY "Users can insert own sales" ON sales
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own sales" ON sales;
CREATE POLICY "Users can update own sales" ON sales
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own sales" ON sales;
CREATE POLICY "Users can delete own sales" ON sales
  FOR DELETE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- debts
DROP POLICY IF EXISTS "Users can insert own debts" ON debts;
CREATE POLICY "Users can insert own debts" ON debts
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own debts" ON debts;
CREATE POLICY "Users can update own debts" ON debts
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- expenses
DROP POLICY IF EXISTS "Users can insert own expenses" ON expenses;
CREATE POLICY "Users can insert own expenses" ON expenses
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own expenses" ON expenses;
CREATE POLICY "Users can update own expenses" ON expenses
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own expenses" ON expenses;
CREATE POLICY "Users can delete own expenses" ON expenses
  FOR DELETE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- customers
DROP POLICY IF EXISTS "Users can insert own customers" ON customers;
CREATE POLICY "Users can insert own customers" ON customers
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own customers" ON customers;
CREATE POLICY "Users can update own customers" ON customers
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can delete own customers" ON customers;
CREATE POLICY "Users can delete own customers" ON customers
  FOR DELETE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- business_profiles (so a suspended tenant cannot flip their own status back)
DROP POLICY IF EXISTS "Users can insert own profile" ON business_profiles;
CREATE POLICY "Users can insert own profile" ON business_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));
DROP POLICY IF EXISTS "Users can update own profile" ON business_profiles;
CREATE POLICY "Users can update own profile" ON business_profiles
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));

-- ============================================================
-- 6. Admin action RPCs (each re-checks admin; SECURITY DEFINER bypasses RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION admin_platform_summary()
  RETURNS TABLE (tenant_count int, active_count int, suspended_count int,
                 gross_revenue numeric, total_profit numeric, total_expenses numeric)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT (SELECT count(*)::int FROM auth.users),
           (SELECT count(*)::int FROM business_profiles WHERE status = 'active'),
           (SELECT count(*)::int FROM business_profiles WHERE status = 'suspended'),
           COALESCE((SELECT sum(total)  FROM sales),0)::numeric,
           COALESCE((SELECT sum(profit) FROM sales),0)::numeric,
           COALESCE((SELECT sum(amount) FROM expenses),0)::numeric;
END $$;

CREATE OR REPLACE FUNCTION admin_list_tenants()
  RETURNS TABLE (user_id uuid, email text, business_name text, status text,
                 created_at timestamptz, total_sales numeric, total_profit numeric,
                 total_expenses numeric, sale_count int, last_activity timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT u.id, u.email::text,
           COALESCE(bp.business_name, 'Unnamed shop'),
           COALESCE(bp.status, 'active'),
           u.created_at,
           COALESCE((SELECT sum(total)  FROM sales    s WHERE s.user_id = u.id),0)::numeric,
           COALESCE((SELECT sum(profit) FROM sales    s WHERE s.user_id = u.id),0)::numeric,
           COALESCE((SELECT sum(amount) FROM expenses e WHERE e.user_id = u.id),0)::numeric,
           COALESCE((SELECT count(*)::int FROM sales s WHERE s.user_id = u.id),0),
           (SELECT max(created_at) FROM sales s WHERE s.user_id = u.id)
    FROM auth.users u
    LEFT JOIN business_profiles bp ON bp.user_id = u.id
    ORDER BY u.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION admin_set_tenant_status(p_user_id uuid, p_status text, p_reason text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'bad status'; END IF;
  INSERT INTO business_profiles (user_id, business_name, status, suspended_at, suspended_reason)
    VALUES (p_user_id, 'My Shop', p_status,
            CASE WHEN p_status='suspended' THEN now() END,
            CASE WHEN p_status='suspended' THEN p_reason END)
  ON CONFLICT (user_id) DO UPDATE
    SET status = excluded.status,
        suspended_at = CASE WHEN excluded.status='suspended' THEN now() END,
        suspended_reason = CASE WHEN excluded.status='suspended' THEN p_reason END;
END $$;

CREATE OR REPLACE FUNCTION admin_delete_tenant(p_user_id uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot delete yourself'; END IF;
  DELETE FROM auth.users WHERE id = p_user_id;  -- cascades all tenant tables
END $$;

-- ============================================================
-- 7. BOOTSTRAP (edit the email, then run once; safe to re-run)
-- ============================================================
-- INSERT INTO super_admins (user_id)
--   SELECT id FROM auth.users WHERE email = 'YOUR_ADMIN_EMAIL'
--   ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Apply the migration in Supabase**

Paste the whole file into the Supabase SQL editor and run it. Then edit the bootstrap block at the bottom with the real admin email, uncomment it, and run that statement once.

- [ ] **Step 3: Verify in the Supabase SQL editor (run as the admin user is not possible here, so check structure + gate)**

Run and confirm no errors / expected rows:

```sql
-- functions exist
SELECT proname FROM pg_proc
 WHERE proname IN ('is_super_admin','is_tenant_active','am_i_super_admin',
                   'admin_platform_summary','admin_list_tenants',
                   'admin_set_tenant_status','admin_delete_tenant');
-- expect 7 rows

-- admin seeded
SELECT u.email FROM super_admins sa JOIN auth.users u ON u.id = sa.user_id;
-- expect your admin email

-- columns added
SELECT column_name FROM information_schema.columns
 WHERE table_name='business_profiles' AND column_name IN ('status','suspended_at','suspended_reason');
-- expect 3 rows
```

Expected: 7 function rows, your admin email, 3 columns.

- [ ] **Step 4: Commit**

```bash
git add src/db/migration_005_super_admin.sql
git commit -m "feat(db): super admin registry, gate functions, admin RPCs, suspend RLS"
```

---

## Task 2: Admin API service

**Files:**
- Create: `src/services/adminApi.ts`

- [ ] **Step 1: Write the service**

Create `src/services/adminApi.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors. (If `Sale`/`Expense` field names differ, open `src/lib/supabase.ts` and match the exact property names — `total`, `profit`, `amount`, `created_at` are expected to already exist there.)

- [ ] **Step 3: Commit**

```bash
git add src/services/adminApi.ts
git commit -m "feat(admin): adminApi service wrapping admin RPCs + drill-in reads"
```

---

## Task 3: Store — admin + suspended state

**Files:**
- Modify: `src/lib/store.tsx`

- [ ] **Step 1: Add fields to the `AppState` interface**

In `src/lib/store.tsx`, find the `AppState` interface (around line 31, near `isOnline: boolean`) and add two fields after `isOnline`:

```ts
  isOnline: boolean
  isSuperAdmin: boolean
  suspended: boolean
```

- [ ] **Step 2: Add the two actions to the `Action` union**

Find the `Action` union (the `| { type: 'SET_ONLINE'; online: boolean }` line) and add:

```ts
  | { type: 'SET_SUPER_ADMIN'; value: boolean }
  | { type: 'SET_SUSPENDED'; value: boolean }
```

- [ ] **Step 3: Add the fields to `initialState`**

Find `initialState` (where `activeTab: 'home',` and `isOnline:` appear) and add:

```ts
  isSuperAdmin: false,
  suspended: false,
```

- [ ] **Step 4: Add the reducer cases**

Find the `case 'SET_ONLINE':` line in `appReducer` and add directly after it:

```ts
    case 'SET_SUPER_ADMIN': return { ...state, isSuperAdmin: action.value }
    case 'SET_SUSPENDED': return { ...state, suspended: action.value }
```

- [ ] **Step 5: Import the admin check and set both flags on load**

At the top of `store.tsx`, add to the imports:

```ts
import { amISuperAdmin } from '@/services/adminApi'
```

In the data-load function (the one containing `const results = await Promise.allSettled([` near line 282), after the existing `if (profile) { dispatch({ type: 'SET_BUSINESS_PROFILE', profile }) }` block (around line 330), add:

```ts
      // Admin + suspension flags
      const admin = await amISuperAdmin()
      dispatch({ type: 'SET_SUPER_ADMIN', value: admin })
      dispatch({ type: 'SET_SUSPENDED', value: (profile?.status === 'suspended') && !admin })
```

Note: `profile` here is the `fetchBusinessProfile()` result already destructured in that function (`results[5]`). If `BusinessProfile` in `src/lib/supabase.ts` does not yet include `status`, add `status?: 'active' | 'suspended'` to that interface.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.tsx src/lib/supabase.ts
git commit -m "feat(store): isSuperAdmin + suspended state, set on load"
```

---

## Task 4: Suspended lockout screen

**Files:**
- Create: `src/components/SuspendedScreen.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/SuspendedScreen.tsx`:

```tsx
import { useStore } from '@/lib/store'
import { signOut } from '@/services/auth'
import { AlertTriangle } from 'lucide-react'

export default function SuspendedScreen() {
  const { state } = useStore()
  const reason = state.businessProfile?.suspended_reason

  return (
    <div className="h-[100dvh] w-full bg-sand flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="w-14 h-14 mx-auto rounded-sm bg-accent-red/10 flex items-center justify-center">
          <AlertTriangle className="text-accent-red" size={28} />
        </div>
        <h1 className="font-display text-xl text-ink uppercase tracking-tight mt-4">
          Account Suspended
        </h1>
        <p className="text-sm text-muted-text mt-2">
          This shop has been suspended by the platform administrator.
          {reason ? ` Reason: ${reason}` : ''}
        </p>
        <p className="text-xs text-muted-text mt-2">
          Contact support to restore access.
        </p>
        <button
          onClick={async () => { await signOut(); window.location.href = '/login' }}
          className="btn-tactile mt-6 h-10 px-6 bg-ink text-white rounded-sm font-display text-xs uppercase"
        >
          Log Out
        </button>
      </div>
    </div>
  )
}
```

Note: confirm `signOut` is exported from `src/services/auth.ts` (Settings already uses logout — match its import). If the function is named differently there, use that name. Confirm `state.businessProfile` exists in the store; `suspended_reason` comes from the `BusinessProfile` type (add `suspended_reason?: string | null` to that interface in `src/lib/supabase.ts` if missing).

- [ ] **Step 2: Render it for suspended non-admins in `App.tsx`**

In `src/App.tsx`, add the import:

```ts
import SuspendedScreen from '@/components/SuspendedScreen'
```

In the `App` component, immediately after the `authLoading` early-return block and before the `return (` of the main shell, add:

```tsx
  if (state.isAuthenticated && state.suspended && !state.isSuperAdmin) {
    return <SuspendedScreen />
  }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SuspendedScreen.tsx src/App.tsx src/lib/supabase.ts
git commit -m "feat(admin): suspended-tenant lockout screen"
```

---

## Task 5: Admin console page

**Files:**
- Create: `src/pages/AdminConsole.tsx`

- [ ] **Step 1: Write the page**

Create `src/pages/AdminConsole.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Search, Shield, Ban, Trash2, Eye, Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import {
  getPlatformSummary, listTenants, setTenantStatus, deleteTenant, getTenantDetail,
  type PlatformSummary, type TenantRow, type TenantDetail,
} from '@/services/adminApi'

export default function AdminConsole() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TenantRow | null>(null)
  const [deleteText, setDeleteText] = useState('')
  const [drill, setDrill] = useState<{ tenant: TenantRow; detail: TenantDetail } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([getPlatformSummary(), listTenants()])
      setSummary(s)
      setTenants(t)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const filtered = tenants.filter((t) =>
    t.business_name.toLowerCase().includes(search.toLowerCase()) ||
    t.email.toLowerCase().includes(search.toLowerCase()))

  async function toggleSuspend(t: TenantRow) {
    const next = t.status === 'suspended' ? 'active' : 'suspended'
    const reason = next === 'suspended'
      ? (window.prompt('Reason for suspension?') ?? '') : ''
    if (next === 'suspended' && reason === '') return
    setBusyId(t.user_id)
    try { await setTenantStatus(t.user_id, next, reason); await load() }
    finally { setBusyId(null) }
  }

  async function doDelete() {
    if (!confirmDelete) return
    setBusyId(confirmDelete.user_id)
    try { await deleteTenant(confirmDelete.user_id); await load() }
    finally { setBusyId(null); setConfirmDelete(null); setDeleteText('') }
  }

  async function openDrill(t: TenantRow) {
    setBusyId(t.user_id)
    try { setDrill({ tenant: t, detail: await getTenantDetail(t.user_id) }) }
    finally { setBusyId(null) }
  }

  if (drill) {
    return (
      <div className="h-full w-full overflow-y-auto bg-sand p-4">
        <button onClick={() => setDrill(null)}
          className="btn-tactile inline-flex items-center gap-1 text-xs text-muted-text mb-3">
          <ArrowLeft size={14} /> Back to tenants
        </button>
        <div className="rounded-sm border-2 border-accent-amber bg-accent-amber/10 px-3 py-2 mb-4">
          <p className="text-xs uppercase font-display text-ink">
            Viewing {drill.tenant.business_name} — read-only (admin)
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat label="Sales" value={formatCurrency(drill.detail.totalSales)} />
          <Stat label="Profit" value={formatCurrency(drill.detail.totalProfit)} />
          <Stat label="Expenses" value={formatCurrency(drill.detail.totalExpenses)} />
        </div>
        <h2 className="font-display text-sm uppercase text-ink mb-2">Recent sales</h2>
        <div className="space-y-1">
          {drill.detail.sales.slice(0, 30).map((s) => (
            <div key={s.id} className="flex justify-between text-sm border-b border-ink/10 py-1">
              <span className="text-ink truncate">{s.product_name}</span>
              <span className="font-display text-ink">{formatCurrency(s.total)}</span>
            </div>
          ))}
          {drill.detail.sales.length === 0 && (
            <p className="text-sm text-muted-text">No sales.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-sand p-4 pb-24">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => navigate('/')}
          className="btn-tactile w-9 h-9 flex items-center justify-center rounded-sm bg-warm-gray">
          <ArrowLeft size={16} />
        </button>
        <Shield size={18} className="text-ink" />
        <h1 className="font-display text-lg uppercase tracking-tight text-ink">Super Admin</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-ink" /></div>
      ) : (
        <>
          {summary && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Stat label="Tenants" value={String(summary.tenant_count)} />
              <Stat label="Suspended" value={String(summary.suspended_count)} />
              <Stat label="Gross revenue" value={formatCurrency(summary.gross_revenue)} />
              <Stat label="Total profit" value={formatCurrency(summary.total_profit)} />
            </div>
          )}

          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shop or email"
              className="w-full h-10 pl-9 pr-3 bg-white border-2 border-ink rounded-sm text-sm" />
          </div>

          <div className="space-y-2">
            {filtered.map((t) => (
              <div key={t.user_id} className="border-2 border-ink rounded-sm bg-white p-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="font-display text-sm text-ink truncate">{t.business_name}</p>
                    <p className="text-xs text-muted-text truncate">{t.email}</p>
                    <p className="text-xs text-muted-text mt-1">
                      {formatCurrency(t.total_sales)} sales · {t.sale_count} orders
                    </p>
                  </div>
                  <span className={`text-[10px] font-display uppercase px-2 py-0.5 rounded-sm ${
                    t.status === 'suspended'
                      ? 'bg-accent-red/15 text-accent-red'
                      : 'bg-accent-green/15 text-accent-green'}`}>
                    {t.status}
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => openDrill(t)} disabled={busyId === t.user_id}
                    className="btn-tactile flex-1 h-8 bg-warm-gray rounded-sm text-xs flex items-center justify-center gap-1">
                    <Eye size={13} /> View
                  </button>
                  <button onClick={() => toggleSuspend(t)} disabled={busyId === t.user_id}
                    className="btn-tactile flex-1 h-8 bg-accent-amber/20 rounded-sm text-xs flex items-center justify-center gap-1">
                    <Ban size={13} /> {t.status === 'suspended' ? 'Unsuspend' : 'Suspend'}
                  </button>
                  <button onClick={() => { setConfirmDelete(t); setDeleteText('') }} disabled={busyId === t.user_id}
                    className="btn-tactile h-8 px-3 bg-accent-red/15 text-accent-red rounded-sm text-xs flex items-center justify-center">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-sm text-muted-text text-center py-8">No tenants.</p>}
          </div>
        </>
      )}

      {confirmDelete && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setConfirmDelete(null)} />
          <div className="fixed inset-x-4 top-1/3 z-[61] bg-sand border-2 border-ink rounded-sm p-4">
            <h3 className="font-display text-lg uppercase text-ink">Delete tenant?</h3>
            <p className="text-sm text-muted-text mt-1">
              Permanently deletes <b>{confirmDelete.business_name}</b> and ALL its data. This cannot be undone.
            </p>
            <p className="text-xs text-muted-text mt-2">Type the shop name to confirm:</p>
            <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)}
              className="w-full h-10 mt-1 px-3 bg-white border-2 border-ink rounded-sm text-sm" />
            <div className="flex gap-2 mt-3">
              <button onClick={() => setConfirmDelete(null)}
                className="btn-tactile flex-1 h-10 bg-warm-gray rounded-sm font-display text-xs uppercase">Cancel</button>
              <button onClick={doDelete}
                disabled={deleteText !== confirmDelete.business_name || busyId === confirmDelete.user_id}
                className="btn-tactile flex-1 h-10 bg-accent-red text-white rounded-sm font-display text-xs uppercase disabled:opacity-40 flex items-center justify-center gap-1">
                <Trash2 size={12} /> Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-ink rounded-sm bg-white p-3">
      <p className="text-[10px] uppercase text-muted-text">{label}</p>
      <p className="font-display text-base text-ink mt-0.5">{value}</p>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors. (If `formatCurrency` lives elsewhere than `@/lib/utils`, fix the import to match the path used in `src/pages/Reports.tsx`. If `Sale.product_name` differs, match `src/lib/supabase.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/AdminConsole.tsx
git commit -m "feat(admin): admin console — summary, tenant list, suspend/delete, drill-in"
```

---

## Task 6: Route + Settings entry

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add the gated `/admin` route**

In `src/App.tsx`, add the import:

```ts
import AdminConsole from '@/pages/AdminConsole'
```

Inside `<Routes>`, add this route before the catch-all `path="/*"` route:

```tsx
          <Route
            path="/admin"
            element={
              state.isAuthenticated && state.isSuperAdmin
                ? <div className="h-full w-full overflow-hidden bg-sand relative"><AdminConsole /></div>
                : <Navigate to="/" replace />
            }
          />
```

- [ ] **Step 2: Add the Settings menu entry (admin only)**

In `src/pages/Settings.tsx`:

Add to the existing icon import line a `Shield` icon (it already imports from `lucide-react`), and import the store hook and router if not already present:

```ts
import { Shield } from 'lucide-react'
import { useNavigate } from 'react-router'
```

Inside the `Settings` component body, near the top where other hooks/state are declared, add:

```ts
  const { state } = useStore()
  const navigate = useNavigate()
```

(If `useStore` is already destructured in this file, add `state` to that existing call instead of adding a second one.)

Find the menu items array (the one containing `{ icon: Trash2, label: 'Reset All Data', ... }`). Build an admin entry and prepend it only for admins. Replace the array literal so it reads:

```ts
  const menuItems = [
    ...(state.isSuperAdmin
      ? [{ icon: Shield, label: 'Super Admin', danger: false, action: () => navigate('/admin') }]
      : []),
    { icon: Trash2, label: 'Reset All Data', danger: true, action: () => setShowConfirmReset(true) },
    { icon: LogOut, label: 'Log Out', danger: true, action: () => setShowConfirmLogout(true) },
  ]
```

(Match the exact property names already used by the existing items — `icon`, `label`, `danger`, `action`. If the existing items lack a `danger` key, omit it from the admin entry too.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/pages/Settings.tsx
git commit -m "feat(admin): gated /admin route + Settings entry for super admins"
```

---

## Task 7: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Non-admin isolation (SQL)**

In the Supabase SQL editor, run while authenticated context is a NON-admin (use the API or a non-admin session). Confirm:

```sql
SELECT am_i_super_admin();          -- expect false for a normal user
SELECT * FROM admin_list_tenants(); -- expect ERROR: forbidden
```

- [ ] **Step 2: Admin happy path (browser)**

Run `npm run dev`. Log in as the bootstrapped admin email.
- Open Settings → a "Super Admin" entry is present. Non-admin accounts must NOT see it.
- Open it → `/admin` shows summary cards + the tenant list.
- Click **View** on a tenant → read-only dashboard with the amber "read-only (admin)" banner and their sales.

- [ ] **Step 3: Suspend enforcement (browser, two accounts)**

- As admin, **Suspend** a test tenant (enter a reason).
- Log in as that tenant in another browser/profile → the `SuspendedScreen` shows; the app shell is not reachable.
- Confirm the tenant cannot create a sale (RLS blocks writes). Then **Unsuspend** as admin → tenant regains access.

- [ ] **Step 4: Delete (browser)**

- As admin, click the trash action on a disposable test tenant, type the shop name to enable the button, confirm.
- The tenant disappears from the list. Verify in SQL that their rows are gone:

```sql
SELECT count(*) FROM sales WHERE user_id = '<deleted-uuid>';  -- expect 0
SELECT count(*) FROM auth.users WHERE id = '<deleted-uuid>';  -- expect 0
```

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A && git commit -m "test(admin): manual verification pass for super admin console"
```

---

## Notes for the implementer

- This repo has **no automated test framework**; do not scaffold one. Verification is typecheck + build + the manual SQL/browser steps above.
- `migration_004` (sales delete policy) MUST already be applied before `migration_005`, because Task 1 Step 5 drops and recreates the `"Users can delete own sales"` policy.
- The admin RPCs are `SECURITY DEFINER` and run as the table owner, so they bypass RLS by design — that is why suspend/delete still work even though normal write policies are tightened.
- If any `src/lib/supabase.ts` interface is missing a field used here (`BusinessProfile.status`, `BusinessProfile.suspended_reason`), add it as an optional field in the same task that first needs it.
