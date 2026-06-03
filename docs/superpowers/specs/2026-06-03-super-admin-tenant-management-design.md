# Super Admin — Tenant Management Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Problem

serwaabroni is a multi-shop SaaS where each `auth.users` row is one **tenant** (a shop).
All business data (products, sales, debts, expenses, customers, business_profiles) is
isolated per tenant by Row Level Security on `user_id`. There is currently **no platform
owner role** — no way for the operator to see all shops, monitor platform-wide revenue,
suspend a non-paying/abusive shop, remove a shop, or inspect a single shop for support.

This design adds a **super admin** capability: monitor all tenants, drill into any tenant
(read-only), suspend/unsuspend a tenant, and permanently delete a tenant.

## Constraints

- **Pure Vite SPA, no backend.** A service-role key (which bypasses RLS) cannot ship to the
  browser. Therefore **all cross-tenant authority must live in Postgres** as RLS policies and
  `SECURITY DEFINER` functions, gated by an `is_super_admin()` check.
- Must not weaken existing per-tenant isolation for normal users.
- Reuse existing patterns: tab/overlay screens, `supabaseApi` service layer, the `store`
  reducer, the `src/db/migration_00X.sql` migration convention (run manually in Supabase).

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| Capabilities | Monitor, Suspend/unsuspend, Delete, Drill-in (read-only) |
| Admin identity | `super_admins` table + `is_super_admin()` SECURITY DEFINER function |
| UI location | Gated overlay screen inside the same app, opened from Settings |
| Delete semantics | **Hard delete** — removes `auth.users` row, cascades all tenant data. Irreversible. |
| Suspend enforcement | **Two layers**: frontend gate (UX) **and** DB write-block via RLS (real enforcement) |
| Impersonation | **Read-only drill-in** via admin SELECT RLS bypass. No session swap / no write-as-tenant (would need a service-role backend — out of scope). |

## Architecture

```
Browser (anon/auth key)                         Postgres (Supabase)
─────────────────────                           ──────────────────────────────
AdminConsole.tsx ── adminApi.ts ──► RPC calls ─► SECURITY DEFINER functions
                                                   guarded by is_super_admin(auth.uid())
                                                 │
store.isSuperAdmin ◄── select super_admins       ├─ admin_platform_summary()
                                                 ├─ admin_list_tenants()
drill-in reads ──► normal table SELECT ─────────►├─ admin_set_tenant_status()
                   (admin SELECT RLS policy)     └─ admin_delete_tenant()
```

No admin authority exists client-side. The browser only *names* an action; Postgres decides
whether the caller is allowed, on every call.

---

## Data model — `src/db/migration_005_super_admin.sql`

```sql
-- 1. Admin registry. RLS on, NO client policies -> the table is invisible to clients.
CREATE TABLE IF NOT EXISTS super_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- 2. Tenant lifecycle on the existing per-shop record.
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'active'
                                            CHECK (status IN ('active','suspended')),
  ADD COLUMN IF NOT EXISTS suspended_at     timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;
```

Note: not every tenant is guaranteed a `business_profiles` row. Helpers treat a **missing
row as active** (a tenant is only suspended when an explicit `status = 'suspended'` row exists).

---

## Functions & policies — same migration

### Gate
```sql
CREATE OR REPLACE FUNCTION is_super_admin(uid uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM super_admins WHERE user_id = uid);
$$;

CREATE OR REPLACE FUNCTION is_tenant_active(uid uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT status <> 'suspended' FROM business_profiles WHERE user_id = uid),
    true   -- no profile row => active
  );
$$;

-- No-arg helper the frontend calls to learn its own admin status, without the
-- client ever reading the super_admins table directly.
CREATE OR REPLACE FUNCTION am_i_super_admin()
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT is_super_admin(auth.uid());
$$;
```

### Monitor / drill-in — admin read bypass
For each tenant table (`products`, `sales`, `debts`, `expenses`, `customers`,
`business_profiles`), add a second permissive SELECT policy (multiple permissive policies are
OR'd, so owner reads keep working):

```sql
CREATE POLICY "Super admin reads all sales"
  ON sales FOR SELECT USING (is_super_admin(auth.uid()));
-- repeat per table
```

### Suspend enforcement — DB write-block (layer 2)
Recreate the owner **INSERT / UPDATE / DELETE** policies to also require the tenant be active.
A suspended tenant keeps read access to their own data but cannot mutate it. Example for
`sales` (apply the same pattern to every tenant-owned table's write policies):

```sql
DROP POLICY IF EXISTS "Users can insert own sales" ON sales;
CREATE POLICY "Users can insert own sales" ON sales
  FOR INSERT WITH CHECK (auth.uid() = user_id AND is_tenant_active(auth.uid()));

DROP POLICY IF EXISTS "Users can update own sales" ON sales;
CREATE POLICY "Users can update own sales" ON sales
  FOR UPDATE USING (auth.uid() = user_id AND is_tenant_active(auth.uid()));
-- (sales delete policy from migration_004 gets the same treatment)
```

Tables/commands to update: products (INSERT/UPDATE/DELETE), sales (INSERT/UPDATE/DELETE),
debts (INSERT/UPDATE), expenses (INSERT/DELETE), customers (INSERT/UPDATE/DELETE),
business_profiles (INSERT/UPDATE). The migration must keep an admin escape so admin RPCs are
unaffected (RPCs are SECURITY DEFINER and run as table owner, bypassing RLS anyway).

### Admin action RPCs — every one re-checks admin
```sql
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
           COALESCE((SELECT sum(total)  FROM sales),0),
           COALESCE((SELECT sum(profit) FROM sales),0),
           COALESCE((SELECT sum(amount) FROM expenses),0);
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
           COALESCE((SELECT sum(total)  FROM sales    s WHERE s.user_id = u.id),0),
           COALESCE((SELECT sum(profit) FROM sales    s WHERE s.user_id = u.id),0),
           COALESCE((SELECT sum(amount) FROM expenses e WHERE e.user_id = u.id),0),
           COALESCE((SELECT count(*)::int FROM sales  s WHERE s.user_id = u.id),0),
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
  DELETE FROM auth.users WHERE id = p_user_id;   -- cascades all tenant tables
END $$;
```

### Bootstrap (run once, manually)
```sql
INSERT INTO super_admins (user_id)
  SELECT id FROM auth.users WHERE email = 'YOUR_ADMIN_EMAIL'
  ON CONFLICT DO NOTHING;
```

---

## Frontend

### `src/services/adminApi.ts` (new)
Thin wrappers over `supabase.rpc(...)` + direct reads:
- `amISuperAdmin(): Promise<boolean>` — `supabase.rpc('am_i_super_admin')`. Never reads the
  `super_admins` table from the client.
- `getPlatformSummary()` → `rpc('admin_platform_summary')`
- `listTenants()` → `rpc('admin_list_tenants')`
- `setTenantStatus(userId, status, reason)` → `rpc('admin_set_tenant_status', …)`
- `deleteTenant(userId)` → `rpc('admin_delete_tenant', …)`
- `getTenantDetail(userId)` — direct reads of that tenant's `sales`/`expenses`/`products`
  (allowed by the admin SELECT policies) for the read-only drill-in view.

### `src/lib/store.tsx`
- Add `isSuperAdmin: boolean` to state + `SET_SUPER_ADMIN` action.
- On data load / `SET_USER`, call `amISuperAdmin()` and dispatch.
- On load, also read own `business_profiles.status`; if `suspended`, expose
  `state.suspended = true` so the shell can show the Suspended screen.

### `src/pages/AdminConsole.tsx` (new, overlay like Settings/SalesHistory)
- Platform summary cards: tenants, active/suspended, gross revenue, total profit, expenses.
- Tenant table: search box; columns business_name, email, status badge, total sales, profit,
  last activity. Row actions: **Drill-in**, **Suspend/Unsuspend**, **Delete**.
- Drill-in → read-only tenant dashboard (their totals + recent sales), with a clear
  "viewing as admin (read-only)" banner and a back button.
- Suspend → confirm + reason input. Delete → **type-to-confirm** (type the shop name) +
  irreversible warning, then `deleteTenant`, then refresh list.

### `src/pages/Settings.tsx`
- Add a "Super Admin" menu item, rendered only when `state.isSuperAdmin`, that opens the
  AdminConsole overlay.

### Suspended tenant shell (frontend gate)
- A `SuspendedScreen` component. When `state.suspended` is true and the user is **not** an
  admin, render it instead of the app shell, with a sign-out button and the suspension reason.

---

## Security model

- The only thing that grants power is membership in `super_admins`. Every admin RPC and admin
  RLS policy derives from `is_super_admin(auth.uid())`; nothing trusts the client.
- `super_admins` has RLS on with no client policies → not readable/writable from the browser.
- All admin functions are `SECURITY DEFINER` with `SET search_path = public` (prevents
  search-path hijacking) and re-check admin before doing anything.
- `admin_delete_tenant` refuses to delete the caller and is the only path that touches
  `auth.users`.
- No service-role key in the frontend bundle.

## Testing strategy

- **SQL/RLS (manual in Supabase, scripted checks):**
  - Non-admin calling each `admin_*` RPC → `forbidden`.
  - Admin calling them → returns data / performs action.
  - Suspended tenant: own SELECT still works; INSERT/UPDATE/DELETE rejected by RLS.
  - Admin SELECT on another tenant's `sales` returns rows; normal user gets none.
  - `admin_delete_tenant` removes the auth user and cascades (no orphan rows).
- **Frontend:**
  - `isSuperAdmin` false → no Settings entry, AdminConsole unreachable.
  - Admin → summary + tenant list render; suspend toggles badge; delete needs type-to-confirm.
  - Suspended non-admin → SuspendedScreen + sign out.

## Out of scope (YAGNI)

- Write-as-tenant impersonation (needs service-role backend).
- Admin audit log, billing/subscriptions, per-tenant quotas, admin-managed admin invites UI
  (admins are added via SQL for now).
- Soft-delete / restore (delete is hard delete by decision).

## Migrations / manual steps

1. Run `src/db/migration_005_super_admin.sql` in Supabase SQL editor.
2. Run the bootstrap `INSERT` with the real admin email.
3. (`migration_004` for sales-delete must already be applied.)
