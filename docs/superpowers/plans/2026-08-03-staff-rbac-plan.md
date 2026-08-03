# Staff Accounts & RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a business owner invite Managers and Staff as real, separately-authenticated Supabase Auth accounts, each restricted to a role-defined subset of the business's data — enforced at the Postgres RLS layer, not just hidden in the UI — per `docs/superpowers/specs/2026-08-03-staff-rbac-design.md`.

**Architecture:** `user_id` columns are never renamed. A new `business_members` table maps a staff/manager auth user to the owner ("business") they belong to. Two `SECURITY DEFINER` SQL functions — `business_id_for(uid)` and `role_for(uid)` — resolve "which tenant does this caller belong to" and "what role are they" respectively, bypassing RLS on `business_members`/`business_profiles` themselves (mirroring the existing `is_super_admin`/`is_tenant_active` pattern in `migration_005_super_admin.sql`). Every existing tenant-scoped RLS policy is rewritten from `auth.uid() = user_id` to `business_id_for(auth.uid()) = user_id`. Owner-only tables get an extra `AND business_id_for(auth.uid()) = auth.uid()` clause. `business_profiles` gets a role check (`role_for(auth.uid()) IN ('owner','manager')`) for its special view-only/no-access split. Client-side, `src/lib/permissions.ts` holds the pure permission matrix, `src/hooks/usePermission.ts` wraps it with store state, and `store.tsx` resolves `role`/`businessId` on auth via new RPC-calling helpers. A new `invite-staff` edge function (service-role, same trust tier as `admin-impersonate`) handles the invite send.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase Postgres (RLS) + Auth, Deno edge functions, Vitest.

## Global Constraints

- Every new/rewritten SQL policy uses the existing `DROP POLICY IF EXISTS "..." ON <table>; CREATE POLICY "..." ON <table> FOR <op> ...` pattern — never `ALTER POLICY` (Postgres can't alter a `USING`/`WITH CHECK` clause in place, and it isn't this codebase's style).
- New migration files follow the existing flat numbered convention in `src/db/`: `migration_023_business_members.sql` (per the spec) through `migration_027_rls_business_profiles.sql`. `migration_022` is reserved by the sibling `multi-industry-categories` feature — do not use it.
- `sync_queue` and `otp_codes` are explicitly out of scope (not in the spec's table list) — do not touch their RLS.
- This codebase's Vitest convention (confirmed by reading every existing `*.test.ts`) only unit-tests **pure** functions — no test mocks the real `supabase` client, and there is no jsdom/React-Testing-Library setup (`vitest.config.ts` has `environment: 'node'`). Every task below that touches an impure Supabase/Deno call therefore extracts the pure decision logic into its own exported function for a real Vitest test, and treats the impure DB/network glue as covered by the task's manual verification checklist — consistent with how RLS itself is verified (per the assignment's instruction, not skipped, just explicitly manual).
- Edge functions (`supabase/functions/**`) are excluded from `vitest.config.ts`'s `include: ['src/**/*.test.ts']` and have zero existing test harness (no `deno.json`, no CLI available) — their tasks use a manual `curl` checklist as the "test", exactly as RLS tasks use a manual SQL checklist.
- Run all Vitest steps with `npx vitest run <path>` from the repo root.
- All SQL steps are pasted into the Supabase SQL Editor for project `qumttowvyujqaubyshjq` (per `supabase/config.toml`) and run once; every `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION` / `DROP POLICY IF EXISTS` + `CREATE POLICY` is idempotent and safe to re-run.

---

### Task 1: `business_members` table + `business_id_for()` / `role_for()` / `activate_membership()`

**Files:**
- Create: `src/db/migration_023_business_members.sql`
- Test: manual SQL Editor checklist (below) — no Vitest coverage possible for RLS/SQL functions.

**Interfaces:**
- Consumes: `auth.users`, `business_profiles` (existing).
- Produces: table `business_members(id, business_id, member_user_id, invited_email, role, status, invited_at, joined_at)`; SQL functions `business_id_for(uid uuid) returns uuid`, `role_for(uid uuid) returns text`, `activate_membership() returns void` — all three consumed by every later task (client RPC calls in Task 2/8, RLS policies in Tasks 3–6, edge functions in Tasks 11/14).

- [ ] **Step 1: Write the failing manual-verification expectation**
  Before writing any SQL, state exactly what must be true so failure is checkable: after running the migration, `select business_id_for('<staff-uid>')` run *as that staff user* (not as the SQL-editor superuser) must return the owner's uid, and `select role_for('<staff-uid>')` must return `'staff'`. Confirm neither function exists yet:
  ```sql
  select proname from pg_proc where proname in ('business_id_for','role_for','activate_membership');
  ```
  Expected: **0 rows** (functions don't exist yet — this is the "test fails" baseline).

- [ ] **Step 2: Run the check to verify it fails**
  Run the query in Step 1 in the Supabase SQL Editor. Confirm it returns 0 rows. If it already returns rows, stop — do not proceed (someone already ran this migration).

- [ ] **Step 3: Write the migration**
  Create `src/db/migration_023_business_members.sql`:
  ```sql
  -- migration_023: business_members — staff/manager accounts scoped to an owner's
  -- tenant. See docs/superpowers/specs/2026-08-03-staff-rbac-design.md §3.
  -- user_id columns on every other domain table are NEVER renamed; RLS instead
  -- re-targets via business_id_for() below.

  CREATE TABLE IF NOT EXISTS business_members (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- owner's user_id = tenant id
    member_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,          -- null until invite accepted
    invited_email  text NOT NULL,
    role           text NOT NULL CHECK (role IN ('manager','staff')),
    status         text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','removed')),
    invited_at     timestamptz NOT NULL DEFAULT now(),
    joined_at      timestamptz,
    UNIQUE (business_id, invited_email)
  );

  ALTER TABLE business_members ENABLE ROW LEVEL SECURITY;

  -- Staff/manager management is owner-only — a member can never read or edit
  -- their own row directly; activate_membership() below is their one narrow
  -- SECURITY DEFINER escape hatch for self-activation on first login.
  CREATE POLICY "Owner can view own staff" ON business_members
    FOR SELECT USING (auth.uid() = business_id);
  CREATE POLICY "Owner can insert own staff" ON business_members
    FOR INSERT WITH CHECK (auth.uid() = business_id);
  CREATE POLICY "Owner can update own staff" ON business_members
    FOR UPDATE USING (auth.uid() = business_id);
  CREATE POLICY "Owner can delete own staff" ON business_members
    FOR DELETE USING (auth.uid() = business_id);

  CREATE INDEX IF NOT EXISTS idx_business_members_business ON business_members(business_id);
  CREATE INDEX IF NOT EXISTS idx_business_members_member ON business_members(member_user_id);

  -- ============================================================
  -- business_id_for(uid): "which tenant does this caller belong to."
  -- Owner resolves to their own id; an ACTIVE staff/manager resolves to their
  -- employer's id. MUST be SECURITY DEFINER (unlike the spec's illustrative
  -- snippet, which omits it): a staff member's own business_members row is only
  -- visible under the owner-only RLS policies above, so a plain SECURITY
  -- INVOKER function called by the staff member themselves would see zero rows
  -- and always resolve NULL — locking every staff/manager out of every table.
  -- This mirrors the existing is_super_admin()/is_tenant_active() pattern in
  -- migration_005_super_admin.sql, which uses SECURITY DEFINER for exactly
  -- this reason (a lookup function that must read a table the caller can't).
  -- ============================================================
  CREATE OR REPLACE FUNCTION business_id_for(uid uuid)
    RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
    SELECT COALESCE(
      (SELECT id FROM auth.users WHERE id = uid AND EXISTS(SELECT 1 FROM business_profiles WHERE business_profiles.user_id = uid)),
      (SELECT business_id FROM business_members WHERE member_user_id = uid AND status = 'active')
    )
  $$;

  -- role_for(uid): 'owner' | 'manager' | 'staff' | NULL. Same SECURITY DEFINER
  -- requirement and rationale as business_id_for() above.
  CREATE OR REPLACE FUNCTION role_for(uid uuid)
    RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
    SELECT COALESCE(
      (SELECT 'owner' FROM business_profiles WHERE user_id = uid),
      (SELECT role FROM business_members WHERE member_user_id = uid AND status = 'active')
    )
  $$;

  -- activate_membership(): self-service invite acceptance. An invited row has
  -- member_user_id = NULL and status = 'invited' until the invitee's FIRST
  -- login, which calls this. It matches the caller's own auth email to any
  -- invited_email row and flips it to active. Must be SECURITY DEFINER: the
  -- owner-only UPDATE policy above would otherwise block the invitee (who is
  -- not the owner) from ever activating their own row.
  CREATE OR REPLACE FUNCTION activate_membership()
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    caller_email text;
  BEGIN
    caller_email := (SELECT email FROM auth.users WHERE id = auth.uid());
    IF caller_email IS NULL THEN RETURN; END IF;
    UPDATE business_members
       SET status = 'active', member_user_id = auth.uid(), joined_at = now()
     WHERE invited_email = caller_email
       AND status = 'invited';
  END $$;
  ```

- [ ] **Step 4: Run the manual verification checklist to confirm it passes**
  Run the migration in the SQL Editor, then run this end-to-end simulation (Supabase's SQL-editor RLS-testing idiom: fake the JWT claims, then `SET LOCAL ROLE authenticated`):
  ```sql
  -- 1. Confirm the functions now exist.
  select proname from pg_proc where proname in ('business_id_for','role_for','activate_membership');
  -- Expected: 3 rows.

  -- 2. Create three throwaway test users via Dashboard → Authentication → Add User
  --    (owner@rbactest.local, manager@rbactest.local, staff@rbactest.local), note their UUIDs
  --    as <owner_uid>, <manager_uid>, <staff_uid>.

  -- 3. Seed an owner profile.
  insert into business_profiles (user_id, business_name) values ('<owner_uid>', 'RBAC Test Shop')
    on conflict (user_id) do nothing;

  -- 4. Seed an ACTIVE manager and staff membership directly (bypassing the
  --    invite flow, which doesn't exist until Task 11/12).
  insert into business_members (business_id, member_user_id, invited_email, role, status, joined_at)
  values
    ('<owner_uid>', '<manager_uid>', 'manager@rbactest.local', 'manager', 'active', now()),
    ('<owner_uid>', '<staff_uid>',   'staff@rbactest.local',   'staff',   'active', now());

  -- 5. Resolve as the OWNER.
  select set_config('request.jwt.claims', json_build_object('sub','<owner_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select business_id_for('<owner_uid>'); -- Expected: <owner_uid>
  select role_for('<owner_uid>');        -- Expected: 'owner'
  reset role;

  -- 6. Resolve as the MANAGER.
  select set_config('request.jwt.claims', json_build_object('sub','<manager_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select business_id_for('<manager_uid>'); -- Expected: <owner_uid>
  select role_for('<manager_uid>');        -- Expected: 'manager'
  reset role;

  -- 7. Resolve as STAFF — this is the critical check the SECURITY DEFINER fix protects.
  select set_config('request.jwt.claims', json_build_object('sub','<staff_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select business_id_for('<staff_uid>'); -- Expected: <owner_uid> (NOT null)
  select role_for('<staff_uid>');        -- Expected: 'staff'
  reset role;

  -- 8. Confirm the owner-only RLS on business_members itself: as staff, direct
  --    SELECT on the table must return 0 rows (they can only be resolved via
  --    the SECURITY DEFINER functions above, never by querying the table).
  select set_config('request.jwt.claims', json_build_object('sub','<staff_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from business_members; -- Expected: 0
  reset role;
  ```
  All checks must match the "Expected" comments exactly.

- [ ] **Step 5: Commit**
  ```bash
  git add src/db/migration_023_business_members.sql
  git commit -m "Add business_members table + business_id_for/role_for/activate_membership RPCs"
  ```

---

### Task 2: Business-scoped id resolution in client services

**Files:**
- Create: `src/services/scopeId.ts`
- Test: `src/services/scopeId.test.ts`
- Modify: `src/services/supabaseApi.ts:10-17`
- Modify: `src/services/batchApi.ts:5-10`

**Interfaces:**
- Consumes: `business_id_for` RPC (Task 1).
- Produces: `resolveScopeId(authUid, rpcBusinessId, rpcError) => string | null` (pure, exported from `src/services/scopeId.ts`); the private `getCurrentUserId()` in `supabaseApi.ts` and `uidOrThrow()` in `batchApi.ts` now resolve to the tenant's **business id** (identical to the raw auth uid for an owner, the owner's id for an active staff/manager) — every existing call site in both files keeps working unchanged since it only reads the return value.

- [ ] **Step 1: Write the failing test**
  Create `src/services/scopeId.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { resolveScopeId } from './scopeId'

  describe('resolveScopeId', () => {
    it('returns null when there is no authenticated user', () => {
      expect(resolveScopeId(null, null, false)).toBeNull()
    })
    it('returns the resolved business id when the RPC succeeds', () => {
      expect(resolveScopeId('staff-uid', 'owner-uid', false)).toBe('owner-uid')
    })
    it('falls back to the raw auth uid when the RPC errors (e.g. offline)', () => {
      expect(resolveScopeId('owner-uid', null, true)).toBe('owner-uid')
    })
    it('falls back to the raw auth uid when the RPC returns nothing', () => {
      expect(resolveScopeId('owner-uid', null, false)).toBe('owner-uid')
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**
  ```bash
  npx vitest run src/services/scopeId.test.ts
  ```
  Expected: fails with `Cannot find module './scopeId'` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**
  Create `src/services/scopeId.ts`:
  ```ts
  // Pure decision logic shared by every service that needs to scope a query by
  // the caller's TENANT (business) rather than their raw auth uid — required so
  // an active Manager/Staff account (whose own uid differs from the owner's)
  // reads/writes the owner's rows instead of an empty bucket under their own id.
  // See docs/superpowers/specs/2026-08-03-staff-rbac-design.md §3.
  export function resolveScopeId(
    authUid: string | null,
    rpcBusinessId: string | null,
    rpcError: boolean,
  ): string | null {
    if (!authUid) return null
    if (rpcError || !rpcBusinessId) return authUid
    return rpcBusinessId
  }
  ```
  Modify `src/services/supabaseApi.ts` — replace lines 10-17:
  ```ts
  async function getCurrentUserId(): Promise<string | null> {
    try {
      const { data } = await supabase.auth.getUser()
      return data.user?.id ?? null
    } catch {
      return null
    }
  }
  ```
  with:
  ```ts
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
  ```
  Add the import at the top of `src/services/supabaseApi.ts` (after the existing `import { consumeForSale, reverseConsumptions } from '@/services/batchApi'` line):
  ```ts
  import { resolveScopeId } from '@/services/scopeId'
  ```
  Modify `src/services/batchApi.ts` — replace lines 5-10:
  ```ts
  async function uidOrThrow(): Promise<string> {
    const { data } = await supabase.auth.getUser()
    const uid = data.user?.id
    if (!uid) throw new Error('Not authenticated')
    return uid
  }
  ```
  with:
  ```ts
  async function uidOrThrow(): Promise<string> {
    const { data } = await supabase.auth.getUser()
    const uid = data.user?.id
    if (!uid) throw new Error('Not authenticated')
    const { data: businessId, error } = await supabase.rpc('business_id_for', { uid })
    return resolveScopeId(uid, (businessId as string) ?? null, !!error) as string
  }
  ```
  Add the import at the top of `src/services/batchApi.ts` (after `import { supabase } from '@/lib/supabase'`):
  ```ts
  import { resolveScopeId } from '@/services/scopeId'
  ```

- [ ] **Step 4: Run test to verify it passes**
  ```bash
  npx vitest run src/services/scopeId.test.ts
  ```
  Expected: `4 passed`.
  Then confirm the whole suite still compiles/passes (this task touches two widely-imported files):
  ```bash
  npx vitest run
  ```
  Expected: all existing suites still pass (no regressions from the two edited files).

- [ ] **Step 5: Commit**
  ```bash
  git add src/services/scopeId.ts src/services/scopeId.test.ts src/services/supabaseApi.ts src/services/batchApi.ts
  git commit -m "Resolve business_id_for() in shared-table service calls so staff/manager scope to their employer's tenant"
  ```

---

### Task 3: RLS rewrite — products, sales, debts

**Files:**
- Create: `src/db/migration_024_rls_business_scope_core.sql`
- Test: manual SQL Editor checklist.

**Interfaces:**
- Consumes: `business_id_for(uid)`, `is_tenant_active(uid)` (existing, from `migration_005_super_admin.sql`).
- Produces: rewritten SELECT/INSERT/UPDATE/DELETE policies on `products`, `sales`, `debts` — consumed at runtime by every client call already updated in Task 2.

- [ ] **Step 1: State the failing expectation**
  Before the migration, as the `<staff_uid>` from Task 1's checklist, insert a product owned by `<owner_uid>` — this must currently **fail** (RLS still checks `auth.uid() = user_id`, and staff's own uid ≠ owner's uid):
  ```sql
  select set_config('request.jwt.claims', json_build_object('sub','<staff_uid>','role','authenticated')::text, true);
  set local role authenticated;
  insert into products (user_id, name, cost_price, selling_price, quantity)
    values ('<owner_uid>', 'Test Rice', 10, 15, 5);
  reset role;
  ```
  Expected: `ERROR: new row violates row-level security policy for table "products"`.

- [ ] **Step 2: Run it to confirm the failure**
  Run the block above in the SQL Editor and confirm you get exactly that RLS error (not a different error).

- [ ] **Step 3: Write the migration**
  Create `src/db/migration_024_rls_business_scope_core.sql`:
  ```sql
  -- migration_024: re-target products/sales/debts RLS from "auth.uid() = user_id"
  -- to "business_id_for(auth.uid()) = user_id" so an active Manager/Staff member
  -- resolves to their employer's rows. See migration_023 for business_id_for().
  --
  -- Every is_tenant_active(auth.uid()) becomes is_tenant_active(business_id_for(auth.uid())).
  -- The original form checked the CALLER's own business_profiles row, which is
  -- empty for a staff/manager account, so COALESCE(...,'true') in
  -- is_tenant_active() always passed and silently bypassed suspension
  -- enforcement for staff. Resolving the owner's id first is a required
  -- corollary of the business_id_for() re-target, not a scope change.

  -- ---- products ----
  DROP POLICY IF EXISTS "Users can view own products" ON products;
  CREATE POLICY "Users can view own products" ON products
    FOR SELECT USING (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can insert own products" ON products;
  CREATE POLICY "Users can insert own products" ON products
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  DROP POLICY IF EXISTS "Users can update own products" ON products;
  CREATE POLICY "Users can update own products" ON products
    FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  DROP POLICY IF EXISTS "Users can delete own products" ON products;
  CREATE POLICY "Users can delete own products" ON products
    FOR DELETE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  -- ---- sales ----
  DROP POLICY IF EXISTS "Users can view own sales" ON sales;
  CREATE POLICY "Users can view own sales" ON sales
    FOR SELECT USING (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can insert own sales" ON sales;
  CREATE POLICY "Users can insert own sales" ON sales
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  DROP POLICY IF EXISTS "Users can update own sales" ON sales;
  CREATE POLICY "Users can update own sales" ON sales
    FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  DROP POLICY IF EXISTS "Users can delete own sales" ON sales;
  CREATE POLICY "Users can delete own sales" ON sales
    FOR DELETE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  -- ---- debts ----
  DROP POLICY IF EXISTS "Users can view own debts" ON debts;
  CREATE POLICY "Users can view own debts" ON debts
    FOR SELECT USING (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can insert own debts" ON debts;
  CREATE POLICY "Users can insert own debts" ON debts
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  DROP POLICY IF EXISTS "Users can update own debts" ON debts;
  CREATE POLICY "Users can update own debts" ON debts
    FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  -- debts DELETE (migration_018) never had an is_tenant_active check — preserved
  -- as-is, only the identity check is re-targeted.
  DROP POLICY IF EXISTS "Users can delete own debts" ON debts;
  CREATE POLICY "Users can delete own debts" ON debts
    FOR DELETE USING (business_id_for(auth.uid()) = user_id);
  ```

- [ ] **Step 4: Run the manual verification checklist to confirm it passes**
  ```sql
  -- Re-run the exact failing insert from Step 1 — it must now SUCCEED.
  select set_config('request.jwt.claims', json_build_object('sub','<staff_uid>','role','authenticated')::text, true);
  set local role authenticated;
  insert into products (user_id, name, cost_price, selling_price, quantity)
    values ('<owner_uid>', 'Test Rice', 10, 15, 5)
    returning id, user_id; -- Expected: 1 row, user_id = <owner_uid>

  select count(*) from products where user_id = '<owner_uid>'; -- Expected: >= 1
  reset role;

  -- As a stranger (any 4th real auth user NOT in business_members / not the
  -- owner), the same insert must still be rejected.
  select set_config('request.jwt.claims', json_build_object('sub','<stranger_uid>','role','authenticated')::text, true);
  set local role authenticated;
  insert into products (user_id, name, cost_price, selling_price, quantity)
    values ('<owner_uid>', 'Should Fail', 1, 2, 1);
  -- Expected: ERROR: new row violates row-level security policy for table "products"
  reset role;
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add src/db/migration_024_rls_business_scope_core.sql
  git commit -m "Re-target products/sales/debts RLS to business_id_for() for staff/manager access"
  ```

---

### Task 4: RLS rewrite — expenses, customers, stock_batches, batch_consumptions

**Files:**
- Create: `src/db/migration_025_rls_business_scope_more.sql`
- Test: manual SQL Editor checklist.

**Interfaces:**
- Consumes: `business_id_for(uid)`, `is_tenant_active(uid)` (Task 1 / existing).
- Produces: rewritten policies on `expenses`, `customers`, `stock_batches`, `batch_consumptions`.

- [ ] **Step 1: State the failing expectation**
  As `<staff_uid>`, attempt to read the owner's expenses — must currently return **0 rows** (not an error; SELECT RLS silently filters):
  ```sql
  select set_config('request.jwt.claims', json_build_object('sub','<staff_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from expenses where user_id = '<owner_uid>'; -- Expected: 0
  reset role;
  ```

- [ ] **Step 2: Run it to confirm the failure**
  Seed one expense as the owner first if none exist, then run Step 1's query and confirm it returns `0`.

- [ ] **Step 3: Write the migration**
  Create `src/db/migration_025_rls_business_scope_more.sql`:
  ```sql
  -- migration_025: re-target expenses/customers/stock_batches/batch_consumptions
  -- RLS to business_id_for(). See migration_024 for the same pattern + rationale.

  -- ---- expenses ----
  DROP POLICY IF EXISTS "Users can view own expenses" ON expenses;
  CREATE POLICY "Users can view own expenses" ON expenses
    FOR SELECT USING (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can insert own expenses" ON expenses;
  CREATE POLICY "Users can insert own expenses" ON expenses
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  DROP POLICY IF EXISTS "Users can delete own expenses" ON expenses;
  CREATE POLICY "Users can delete own expenses" ON expenses
    FOR DELETE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  -- ---- customers ----
  DROP POLICY IF EXISTS "Users can view own customers" ON customers;
  CREATE POLICY "Users can view own customers" ON customers
    FOR SELECT USING (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can insert own customers" ON customers;
  CREATE POLICY "Users can insert own customers" ON customers
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  DROP POLICY IF EXISTS "Users can update own customers" ON customers;
  CREATE POLICY "Users can update own customers" ON customers
    FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  DROP POLICY IF EXISTS "Users can delete own customers" ON customers;
  CREATE POLICY "Users can delete own customers" ON customers
    FOR DELETE USING (business_id_for(auth.uid()) = user_id AND is_tenant_active(business_id_for(auth.uid())));

  -- ---- stock_batches ---- (never had is_tenant_active — preserved as-is)
  DROP POLICY IF EXISTS "Users can view own batches" ON stock_batches;
  CREATE POLICY "Users can view own batches" ON stock_batches
    FOR SELECT USING (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can insert own batches" ON stock_batches;
  CREATE POLICY "Users can insert own batches" ON stock_batches
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can update own batches" ON stock_batches;
  CREATE POLICY "Users can update own batches" ON stock_batches
    FOR UPDATE USING (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can delete own batches" ON stock_batches;
  CREATE POLICY "Users can delete own batches" ON stock_batches
    FOR DELETE USING (business_id_for(auth.uid()) = user_id);

  -- ---- batch_consumptions ----
  DROP POLICY IF EXISTS "Users can view own consumptions" ON batch_consumptions;
  CREATE POLICY "Users can view own consumptions" ON batch_consumptions
    FOR SELECT USING (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can insert own consumptions" ON batch_consumptions;
  CREATE POLICY "Users can insert own consumptions" ON batch_consumptions
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id);

  DROP POLICY IF EXISTS "Users can delete own consumptions" ON batch_consumptions;
  CREATE POLICY "Users can delete own consumptions" ON batch_consumptions
    FOR DELETE USING (business_id_for(auth.uid()) = user_id);
  ```

- [ ] **Step 4: Run the manual verification checklist to confirm it passes**
  ```sql
  select set_config('request.jwt.claims', json_build_object('sub','<staff_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from expenses where user_id = '<owner_uid>';        -- Expected: >= 1 (matches the seeded row)
  select count(*) from customers where user_id = '<owner_uid>';       -- Expected: matches owner's real customer count
  select count(*) from stock_batches where user_id = '<owner_uid>';   -- Expected: matches owner's real batch count
  reset role;
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add src/db/migration_025_rls_business_scope_more.sql
  git commit -m "Re-target expenses/customers/stock_batches/batch_consumptions RLS to business_id_for()"
  ```

---

### Task 5: RLS rewrite — owner-only tables (cash_movements, capital_injections, repayment_installments)

**Files:**
- Create: `src/db/migration_026_rls_owner_only.sql`
- Test: manual SQL Editor checklist.

**Interfaces:**
- Consumes: `business_id_for(uid)` (Task 1).
- Produces: rewritten owner-only policies on `cash_movements`, `capital_injections`, `repayment_installments`.

- [ ] **Step 1: State the failing expectation**
  As `<staff_uid>`, cash_movements is currently reachable under the OLD `auth.uid() = user_id` policy only when staff's own uid equals the row's user_id — which never happens for a real owner's row, so this already returns 0 today. The real failing case for THIS task is the opposite risk: after the business_id_for() re-target alone (without the extra owner-only clause), staff/manager would gain SELECT access to the owner's cash (since business_id_for(staff) = owner). Confirm that risk exists in principle by checking the clause is currently plain:
  ```sql
  select polname, pg_get_expr(polqual, polrelid) as using_clause
  from pg_policy where polrelid = 'cash_movements'::regclass;
  ```
  Expected: clauses still read `(auth.uid() = user_id)` — i.e., not yet locked to owner-only via `business_id_for`.

- [ ] **Step 2: Run it to confirm the current state**
  Run the query in Step 1 and confirm the `using_clause` values are the old `auth.uid() = user_id` form (or in the case of the INSERT policy, the corresponding `WITH CHECK` clause) — this is the "before" state the migration must change.

- [ ] **Step 3: Write the migration**
  Create `src/db/migration_026_rls_owner_only.sql`:
  ```sql
  -- migration_026: cash_movements, capital_injections, and repayment_installments
  -- stay OWNER-ONLY per docs/superpowers/specs/2026-08-03-staff-rbac-design.md §3/§5.
  -- Manager and Staff resolve business_id_for(auth.uid()) to the owner's id (same
  -- as every other table) but must ALSO satisfy
  -- "business_id_for(auth.uid()) = auth.uid()" — only ever true when the caller
  -- IS the owner (business_id_for(owner) always equals the owner's own uid).

  -- ---- cash_movements ----
  DROP POLICY IF EXISTS "Users can view own cash_movements" ON cash_movements;
  CREATE POLICY "Users can view own cash_movements" ON cash_movements
    FOR SELECT USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can insert own cash_movements" ON cash_movements;
  CREATE POLICY "Users can insert own cash_movements" ON cash_movements
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can update own cash_movements" ON cash_movements;
  CREATE POLICY "Users can update own cash_movements" ON cash_movements
    FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can delete own cash_movements" ON cash_movements;
  CREATE POLICY "Users can delete own cash_movements" ON cash_movements
    FOR DELETE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  -- ---- capital_injections ----
  DROP POLICY IF EXISTS "Users can view own injections" ON capital_injections;
  CREATE POLICY "Users can view own injections" ON capital_injections
    FOR SELECT USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can insert own injections" ON capital_injections;
  CREATE POLICY "Users can insert own injections" ON capital_injections
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can update own injections" ON capital_injections;
  CREATE POLICY "Users can update own injections" ON capital_injections
    FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can delete own injections" ON capital_injections;
  CREATE POLICY "Users can delete own injections" ON capital_injections
    FOR DELETE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  -- ---- repayment_installments ----
  DROP POLICY IF EXISTS "Users can view own installments" ON repayment_installments;
  CREATE POLICY "Users can view own installments" ON repayment_installments
    FOR SELECT USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can insert own installments" ON repayment_installments;
  CREATE POLICY "Users can insert own installments" ON repayment_installments
    FOR INSERT WITH CHECK (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can update own installments" ON repayment_installments;
  CREATE POLICY "Users can update own installments" ON repayment_installments
    FOR UPDATE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());

  DROP POLICY IF EXISTS "Users can delete own installments" ON repayment_installments;
  CREATE POLICY "Users can delete own installments" ON repayment_installments
    FOR DELETE USING (business_id_for(auth.uid()) = user_id AND business_id_for(auth.uid()) = auth.uid());
  ```

- [ ] **Step 4: Run the manual verification checklist to confirm it passes**
  ```sql
  -- Seed one cash_movements row as the owner first if none exist.
  -- As MANAGER: must see ZERO rows despite business_id_for(manager) = owner.
  select set_config('request.jwt.claims', json_build_object('sub','<manager_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from cash_movements where user_id = '<owner_uid>';       -- Expected: 0
  select count(*) from capital_injections where user_id = '<owner_uid>';  -- Expected: 0
  reset role;

  -- As STAFF: same — zero rows.
  select set_config('request.jwt.claims', json_build_object('sub','<staff_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from cash_movements where user_id = '<owner_uid>'; -- Expected: 0
  reset role;

  -- As OWNER: full access, unchanged.
  select set_config('request.jwt.claims', json_build_object('sub','<owner_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from cash_movements where user_id = '<owner_uid>'; -- Expected: >= 1
  reset role;
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add src/db/migration_026_rls_owner_only.sql
  git commit -m "Lock cash_movements/capital_injections/repayment_installments RLS to owner-only"
  ```

---

### Task 6: RLS rewrite — business_profiles (Manager view-only, Staff none)

**Files:**
- Create: `src/db/migration_027_rls_business_profiles.sql`
- Test: manual SQL Editor checklist.

**Interfaces:**
- Consumes: `business_id_for(uid)`, `role_for(uid)`, `is_tenant_active(uid)` (Task 1 / existing).
- Produces: rewritten `business_profiles` SELECT (owner+manager)/INSERT (owner-only)/UPDATE (owner-only) policies.

- [ ] **Step 1: State the failing expectation**
  As `<manager_uid>`, reading the owner's business_profiles row currently returns **0 rows** (old policy is `auth.uid() = user_id`, and manager's own uid ≠ owner's uid):
  ```sql
  select set_config('request.jwt.claims', json_build_object('sub','<manager_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from business_profiles where user_id = '<owner_uid>'; -- Expected: 0 (this is what we're about to fix for Manager)
  reset role;
  ```

- [ ] **Step 2: Run it to confirm the failure**
  Run the query above and confirm `0`.

- [ ] **Step 3: Write the migration**
  Create `src/db/migration_027_rls_business_profiles.sql`:
  ```sql
  -- migration_027: business_profiles special case — Owner: full read/write.
  -- Manager: view-only. Staff: no access at all (role_for() must be 'owner' or
  -- 'manager' just to SELECT). See docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5.

  DROP POLICY IF EXISTS "Users can view own profile" ON business_profiles;
  CREATE POLICY "Users can view own profile" ON business_profiles
    FOR SELECT USING (
      business_id_for(auth.uid()) = user_id
      AND role_for(auth.uid()) IN ('owner', 'manager')
    );

  -- INSERT/UPDATE stay owner-only: Manager can view but never edit, Staff can't
  -- touch this table at all. Reuses the same owner-only idiom as migration_026.
  DROP POLICY IF EXISTS "Users can insert own profile" ON business_profiles;
  CREATE POLICY "Users can insert own profile" ON business_profiles
    FOR INSERT WITH CHECK (
      business_id_for(auth.uid()) = user_id
      AND business_id_for(auth.uid()) = auth.uid()
      AND is_tenant_active(business_id_for(auth.uid()))
    );

  DROP POLICY IF EXISTS "Users can update own profile" ON business_profiles;
  CREATE POLICY "Users can update own profile" ON business_profiles
    FOR UPDATE USING (
      business_id_for(auth.uid()) = user_id
      AND business_id_for(auth.uid()) = auth.uid()
      AND is_tenant_active(business_id_for(auth.uid()))
    );
  ```

- [ ] **Step 4: Run the manual verification checklist to confirm it passes**
  ```sql
  -- MANAGER can now view.
  select set_config('request.jwt.claims', json_build_object('sub','<manager_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from business_profiles where user_id = '<owner_uid>'; -- Expected: 1

  -- MANAGER cannot edit.
  update business_profiles set business_name = 'Hacked' where user_id = '<owner_uid>';
  -- Expected: UPDATE 0 (silently affects 0 rows — RLS blocks it, no error)
  reset role;

  -- STAFF cannot even view.
  select set_config('request.jwt.claims', json_build_object('sub','<staff_uid>','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) from business_profiles where user_id = '<owner_uid>'; -- Expected: 0
  reset role;

  -- OWNER unaffected.
  select set_config('request.jwt.claims', json_build_object('sub','<owner_uid>','role','authenticated')::text, true);
  set local role authenticated;
  update business_profiles set business_name = 'RBAC Test Shop 2' where user_id = '<owner_uid>' returning business_name;
  -- Expected: 1 row, business_name = 'RBAC Test Shop 2'
  reset role;
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add src/db/migration_027_rls_business_profiles.sql
  git commit -m "Give Manager view-only access to business_profiles, keep Staff locked out"
  ```

---

### Task 7: Pure permission matrix (`src/lib/permissions.ts`)

**Files:**
- Create: `src/lib/permissions.ts`
- Test: `src/lib/permissions.test.ts`

**Interfaces:**
- Consumes: nothing (pure, standalone).
- Produces: `type Role = 'owner' | 'manager' | 'staff'`; `type PermissionArea`; `canView(role, area) => boolean`; `type SettingsAccess = 'edit' | 'view' | 'none'`; `settingsAccessFor(role) => SettingsAccess`; `visibleMainTabKeys(role) => Array<'home'|'stock'|'debts'|'reports'>` — all consumed by Task 8 (store.tsx), Task 9 (`usePermission`), Task 10 (gating), Task 12 (Settings), Task 13 (`fetchProducts`).

- [ ] **Step 1: Write the failing test**
  Create `src/lib/permissions.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { canView, settingsAccessFor, visibleMainTabKeys } from './permissions'

  describe('canView', () => {
    it('grants owner every area', () => {
      expect(canView('owner', 'cashFlow')).toBe(true)
      expect(canView('owner', 'capital')).toBe(true)
      expect(canView('owner', 'staffManage')).toBe(true)
      expect(canView('owner', 'costPrice')).toBe(true)
    })
    it('grants manager sales/stock/expenses/reports/costPrice but not cash/capital/staff', () => {
      expect(canView('manager', 'expenses')).toBe(true)
      expect(canView('manager', 'reports')).toBe(true)
      expect(canView('manager', 'costPrice')).toBe(true)
      expect(canView('manager', 'cashFlow')).toBe(false)
      expect(canView('manager', 'capital')).toBe(false)
      expect(canView('manager', 'staffManage')).toBe(false)
    })
    it('grants staff only sales/stock/customersDebts/voiceAgent', () => {
      expect(canView('staff', 'sales')).toBe(true)
      expect(canView('staff', 'stockEdit')).toBe(true)
      expect(canView('staff', 'customersDebts')).toBe(true)
      expect(canView('staff', 'voiceAgent')).toBe(true)
      expect(canView('staff', 'expenses')).toBe(false)
      expect(canView('staff', 'reports')).toBe(false)
      expect(canView('staff', 'cashFlow')).toBe(false)
      expect(canView('staff', 'capital')).toBe(false)
      expect(canView('staff', 'costPrice')).toBe(false)
    })
    it('denies everything when role is null/undefined', () => {
      expect(canView(null, 'sales')).toBe(false)
      expect(canView(undefined, 'sales')).toBe(false)
    })
  })

  describe('settingsAccessFor', () => {
    it('owner can edit, manager view-only, staff none', () => {
      expect(settingsAccessFor('owner')).toBe('edit')
      expect(settingsAccessFor('manager')).toBe('view')
      expect(settingsAccessFor('staff')).toBe('none')
      expect(settingsAccessFor(null)).toBe('none')
    })
  })

  describe('visibleMainTabKeys', () => {
    it('includes reports for owner and manager, excludes it for staff', () => {
      expect(visibleMainTabKeys('owner')).toEqual(['home', 'stock', 'debts', 'reports'])
      expect(visibleMainTabKeys('manager')).toEqual(['home', 'stock', 'debts', 'reports'])
      expect(visibleMainTabKeys('staff')).toEqual(['home', 'stock', 'debts'])
      expect(visibleMainTabKeys(null)).toEqual(['home', 'stock', 'debts'])
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**
  ```bash
  npx vitest run src/lib/permissions.test.ts
  ```
  Expected: fails with `Cannot find module './permissions'`.

- [ ] **Step 3: Write minimal implementation**
  Create `src/lib/permissions.ts`:
  ```ts
  // Pure RBAC matrix — single source of truth for role-gated UI decisions.
  // Mirrors docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5. The actual
  // enforcement lives in Postgres RLS (migrations 023-027); this only decides
  // what the UI shows/hides so users aren't shown actions the DB will reject.
  export type Role = 'owner' | 'manager' | 'staff'

  export type PermissionArea =
    | 'sales'
    | 'stockView'
    | 'stockEdit'
    | 'customersDebts'
    | 'voiceAgent'
    | 'expenses'
    | 'reports'
    | 'cashFlow'
    | 'capital'
    | 'staffManage'
    | 'costPrice'

  const MATRIX: Record<PermissionArea, Record<Role, boolean>> = {
    sales:          { owner: true, manager: true, staff: true },
    stockView:      { owner: true, manager: true, staff: true },
    stockEdit:      { owner: true, manager: true, staff: true },
    customersDebts: { owner: true, manager: true, staff: true },
    voiceAgent:     { owner: true, manager: true, staff: true },
    expenses:       { owner: true, manager: true, staff: false },
    reports:        { owner: true, manager: true, staff: false },
    cashFlow:       { owner: true, manager: false, staff: false },
    capital:        { owner: true, manager: false, staff: false },
    staffManage:    { owner: true, manager: false, staff: false },
    costPrice:      { owner: true, manager: true, staff: false },
  }

  export function canView(role: Role | null | undefined, area: PermissionArea): boolean {
    if (!role) return false
    return MATRIX[area][role]
  }

  export type SettingsAccess = 'edit' | 'view' | 'none'

  // Business settings: Owner edits, Manager views only, Staff has no access at all.
  export function settingsAccessFor(role: Role | null | undefined): SettingsAccess {
    if (role === 'owner') return 'edit'
    if (role === 'manager') return 'view'
    return 'none'
  }

  // BottomNav shows the Reports tab only to roles allowed to view it.
  export function visibleMainTabKeys(role: Role | null | undefined): Array<'home' | 'stock' | 'debts' | 'reports'> {
    const tabs: Array<'home' | 'stock' | 'debts' | 'reports'> = ['home', 'stock', 'debts']
    if (canView(role, 'reports')) tabs.push('reports')
    return tabs
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  ```bash
  npx vitest run src/lib/permissions.test.ts
  ```
  Expected: `10 passed`.

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/permissions.ts src/lib/permissions.test.ts
  git commit -m "Add pure RBAC permission matrix mirroring the staff-rbac design spec"
  ```

---

### Task 8: Role/businessId resolution + store.tsx wiring

**Files:**
- Create: `src/services/roleApi.ts`
- Test: `src/services/roleApi.test.ts`
- Modify: `src/lib/store.tsx` (interfaces, reducer, initial state, auth effect, `refreshData`)

**Interfaces:**
- Consumes: `Role` (Task 7); `role_for`, `business_id_for`, `activate_membership` RPCs (Task 1).
- Produces: `parseRole(data, error) => Role | null` (pure, tested); `activateMembership() => Promise<void>`; `fetchRole(uid) => Promise<Role | null>`; `fetchBusinessId(uid) => Promise<string | null>`; `useStore().state.role: Role | null` and `useStore().state.businessId: string | null` — consumed by Task 9 (`usePermission`) and Task 13 (`fetchProducts(state.role)`).

- [ ] **Step 1: Write the failing test**
  Create `src/services/roleApi.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { parseRole } from './roleApi'

  describe('parseRole', () => {
    it('returns null when the RPC errored', () => {
      expect(parseRole('owner', true)).toBeNull()
    })
    it('returns null for an unexpected value', () => {
      expect(parseRole('admin', false)).toBeNull()
      expect(parseRole(null, false)).toBeNull()
    })
    it('returns the role for each valid value', () => {
      expect(parseRole('owner', false)).toBe('owner')
      expect(parseRole('manager', false)).toBe('manager')
      expect(parseRole('staff', false)).toBe('staff')
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**
  ```bash
  npx vitest run src/services/roleApi.test.ts
  ```
  Expected: fails with `Cannot find module './roleApi'`.

- [ ] **Step 3: Write minimal implementation**
  Create `src/services/roleApi.ts`:
  ```ts
  import { supabase } from '@/lib/supabase'
  import type { Role } from '@/lib/permissions'

  // Pure: turns a raw role_for() RPC result into a safe Role, defaulting to
  // null on any error or unexpected value so an unresolvable role never
  // silently grants access.
  export function parseRole(data: unknown, error: unknown): Role | null {
    if (error) return null
    return data === 'owner' || data === 'manager' || data === 'staff' ? data : null
  }

  // Self-service invite acceptance — flips a matching invited business_members
  // row to active on this user's first login. Safe to call on every login
  // (no-op if there's no matching invited row).
  export async function activateMembership(): Promise<void> {
    try { await supabase.rpc('activate_membership') } catch { /* best effort, e.g. offline */ }
  }

  export async function fetchRole(uid: string): Promise<Role | null> {
    try {
      const { data, error } = await supabase.rpc('role_for', { uid })
      return parseRole(data, !!error)
    } catch {
      return null
    }
  }

  export async function fetchBusinessId(uid: string): Promise<string | null> {
    try {
      const { data, error } = await supabase.rpc('business_id_for', { uid })
      if (error || !data) return null
      return data as string
    } catch {
      return null
    }
  }
  ```

  Modify `src/lib/store.tsx`. Add imports (after the existing `import { amISuperAdmin, impersonateTenant, stopImpersonation, readAdminBackup } from '@/services/adminApi'` line):
  ```ts
  import { activateMembership, fetchRole, fetchBusinessId } from '@/services/roleApi'
  import type { Role } from '@/lib/permissions'
  ```

  In `AppState` (after `impersonating: { tenantId: string; tenantName: string } | null`), add:
  ```ts
    role: Role | null
    businessId: string | null
  ```

  In the `Action` union (after `| { type: 'SET_IMPERSONATING'; value: { tenantId: string; tenantName: string } | null }`), add:
  ```ts
    | { type: 'SET_ROLE'; role: Role | null }
    | { type: 'SET_BUSINESS_ID'; businessId: string | null }
  ```

  In `initialState` (after `impersonating: null,`), add:
  ```ts
    role: null,
    businessId: null,
  ```

  In `appReducer` (after `case 'SET_IMPERSONATING': return { ...state, impersonating: action.value }`), add:
  ```ts
    case 'SET_ROLE': return { ...state, role: action.role }
    case 'SET_BUSINESS_ID': return { ...state, businessId: action.businessId }
  ```

  Inside `StoreProvider`, immediately before the `// Check auth on mount` `useEffect` (before `useEffect(() => { checkAuth()...`), add:
  ```ts
    const resolveRoleAndDispatch = async (uid: string) => {
      await activateMembership()
      const [role, businessId] = await Promise.all([fetchRole(uid), fetchBusinessId(uid)])
      dispatch({ type: 'SET_ROLE', role })
      dispatch({ type: 'SET_BUSINESS_ID', businessId })
    }
  ```

  Replace the auth-bootstrap `useEffect` body:
  ```ts
    checkAuth().then((session) => {
      reconcileActiveUser(session?.id ?? null)
      dispatch({ type: 'SET_USER', user: session })
    }).catch(() => {
      reconcileActiveUser(null)
      dispatch({ type: 'SET_USER', user: null })
    })

    // Listen for Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        reconcileActiveUser(session.user.id)
        dispatch({
          type: 'SET_USER',
          user: {
            id: session.user.id,
            email: session.user.email!,
            phone: session.user.user_metadata?.phone,
            business_name: session.user.user_metadata?.business_name,
            logo: session.user.user_metadata?.logo || localStorage.getItem('serwaabroni_logo') || undefined,
          },
        })
        const backup = readAdminBackup()
        dispatch({
          type: 'SET_IMPERSONATING',
          value: backup ? { tenantId: session.user.id, tenantName: backup.tenantName } : null,
        })
      } else {
        reconcileActiveUser(null)
        dispatch({ type: 'SET_USER', user: null })
        dispatch({ type: 'SET_IMPERSONATING', value: null })
      }
    })

    return () => subscription.unsubscribe()
  ```
  with:
  ```ts
    checkAuth().then((session) => {
      reconcileActiveUser(session?.id ?? null)
      dispatch({ type: 'SET_USER', user: session })
      if (session?.id) {
        resolveRoleAndDispatch(session.id)
      } else {
        dispatch({ type: 'SET_ROLE', role: null })
        dispatch({ type: 'SET_BUSINESS_ID', businessId: null })
      }
    }).catch(() => {
      reconcileActiveUser(null)
      dispatch({ type: 'SET_USER', user: null })
      dispatch({ type: 'SET_ROLE', role: null })
      dispatch({ type: 'SET_BUSINESS_ID', businessId: null })
    })

    // Listen for Supabase auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        reconcileActiveUser(session.user.id)
        dispatch({
          type: 'SET_USER',
          user: {
            id: session.user.id,
            email: session.user.email!,
            phone: session.user.user_metadata?.phone,
            business_name: session.user.user_metadata?.business_name,
            logo: session.user.user_metadata?.logo || localStorage.getItem('serwaabroni_logo') || undefined,
          },
        })
        resolveRoleAndDispatch(session.user.id)
        const backup = readAdminBackup()
        dispatch({
          type: 'SET_IMPERSONATING',
          value: backup ? { tenantId: session.user.id, tenantName: backup.tenantName } : null,
        })
      } else {
        reconcileActiveUser(null)
        dispatch({ type: 'SET_USER', user: null })
        dispatch({ type: 'SET_IMPERSONATING', value: null })
        dispatch({ type: 'SET_ROLE', role: null })
        dispatch({ type: 'SET_BUSINESS_ID', businessId: null })
      }
    })

    return () => subscription.unsubscribe()
  ```

  Finally, in `refreshData`, change the fetch call and its deps so a role resolved just after the initial load triggers a corrected re-fetch (needed for Task 13's cost_price masking). Replace:
  ```ts
      const results = await Promise.allSettled([
        fetchProducts(),
        fetchSales(),
  ```
  with:
  ```ts
      const results = await Promise.allSettled([
        fetchProducts(state.role),
        fetchSales(),
  ```
  and replace the closing dependency array `}, [syncPending])` (the one belonging to `refreshData`) with `}, [syncPending, state.role])`. Then, in the effect that calls `refreshData`, replace:
  ```ts
    if (state.authLoading) return // wait for auth check
    isFirstLoad.current = false
  ```
  … (leave the body untouched) and replace its dependency array `[state.authLoading, state.isAuthenticated, state.user?.id, refreshData, syncPending]` with `[state.authLoading, state.isAuthenticated, state.user?.id, state.role, refreshData, syncPending]`.

- [ ] **Step 4: Run test to verify it passes**
  ```bash
  npx vitest run src/services/roleApi.test.ts
  ```
  Expected: `4 passed`.
  Then run the whole suite to confirm `store.tsx` still compiles (TypeScript errors surface at test/build time even for untested files):
  ```bash
  npx vitest run
  ```
  Expected: all suites pass, no TS compile errors.

- [ ] **Step 5: Commit**
  ```bash
  git add src/services/roleApi.ts src/services/roleApi.test.ts src/lib/store.tsx
  git commit -m "Resolve role/businessId on auth and expose them via useStore()"
  ```

---

### Task 9: `usePermission` hook

**Files:**
- Create: `src/hooks/usePermission.ts`

**Interfaces:**
- Consumes: `useStore().state.role` (Task 8); `canView`, `settingsAccessFor`, `type PermissionArea`, `type SettingsAccess` (Task 7).
- Produces: `usePermission() => { role: Role | null; isOwner: boolean; isManager: boolean; isStaff: boolean; canView: (area: PermissionArea) => boolean; settingsAccess: SettingsAccess }` — consumed by Task 10 (gating), Task 12 (Settings UI).

- [ ] **Step 1: Write the failing test**
  This hook is a thin wrapper over `useStore()` (a React context) with no DOM-testing infra in this repo (confirmed: no jsdom/RTL, `vitest.config.ts` uses `environment: 'node'`). Its only logic (`canView`/`settingsAccessFor`) is already fully covered by Task 7's `permissions.test.ts`. There is nothing new and pure to assert here beyond "the file exports the expected shape," so this step documents the manual check instead of a Vitest test: after Step 3, grep-confirm the exported symbol exists and the project still type-checks.
  ```bash
  grep -n "export function usePermission" src/hooks/usePermission.ts
  ```
  Expected before Step 3: no output (file doesn't exist).

- [ ] **Step 2: Confirm it fails**
  ```bash
  grep -n "export function usePermission" src/hooks/usePermission.ts 2>&1
  ```
  Expected: `src/hooks/usePermission.ts: No such file or directory`.

- [ ] **Step 3: Write minimal implementation**
  Create `src/hooks/usePermission.ts`:
  ```ts
  import { useStore } from '@/lib/store'
  import { canView as canViewFor, settingsAccessFor, type PermissionArea, type SettingsAccess } from '@/lib/permissions'

  export function usePermission() {
    const { state } = useStore()
    const role = state.role
    return {
      role,
      isOwner: role === 'owner',
      isManager: role === 'manager',
      isStaff: role === 'staff',
      canView: (area: PermissionArea) => canViewFor(role, area),
      settingsAccess: settingsAccessFor(role) as SettingsAccess,
    }
  }
  ```

- [ ] **Step 4: Confirm it passes**
  ```bash
  grep -n "export function usePermission" src/hooks/usePermission.ts
  ```
  Expected: prints the matching line. Then confirm the whole project still compiles:
  ```bash
  npx vitest run
  ```
  Expected: all suites pass.

- [ ] **Step 5: Commit**
  ```bash
  git add src/hooks/usePermission.ts
  git commit -m "Add usePermission hook wrapping the RBAC matrix with store state"
  ```

---

### Task 10: Route/tab gating (BottomNav, App, Dashboard)

**Files:**
- Modify: `src/components/BottomNav.tsx:1-11, 32-57`
- Modify: `src/App.tsx:157-174`
- Modify: `src/pages/Dashboard.tsx:1, 21, 122-151`

**Interfaces:**
- Consumes: `usePermission()` (Task 9); `visibleMainTabKeys(role)` (Task 7).
- Produces: no new exports — this is the first task whose "deliverable" is UI behavior, verified manually (no RTL in this repo).

- [ ] **Step 1: State the failing expectation**
  Before editing, `BottomNav.tsx`'s `mainTabs` list is hardcoded (lines 6-11) and always renders all 4 tabs including `reports`; `App.tsx`'s `/cash` and `/capital` routes (lines 157-174) only check `state.isAuthenticated`, not role. Confirm this by reading the current code (already quoted below) — this is the "before" state that must change.

- [ ] **Step 2: Confirm the current (pre-fix) behavior**
  ```bash
  grep -n "mainTabs" src/components/BottomNav.tsx
  grep -n "path=\"/cash\"\|path=\"/capital\"" src/App.tsx
  ```
  Expected: `mainTabs` is a static array with no role filter; both routes gate only on `state.isAuthenticated`.

- [ ] **Step 3: Write minimal implementation**
  Modify `src/components/BottomNav.tsx` — replace lines 1-11:
  ```ts
  import { LayoutGrid, Package, CirclePlus, ScrollText, BarChart3, Settings } from 'lucide-react'
  import { Link, useNavigate, useLocation } from 'react-router'
  import { useStore } from '@/lib/store'
  import type { Tab } from '@/lib/store'

  const mainTabs: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { key: 'home', label: 'HOME', icon: LayoutGrid },
    { key: 'stock', label: 'STOCK', icon: Package },
    { key: 'debts', label: 'DEBTS', icon: ScrollText },
    { key: 'reports', label: 'REPORT', icon: BarChart3 },
  ]
  ```
  with:
  ```ts
  import { LayoutGrid, Package, CirclePlus, ScrollText, BarChart3, Settings } from 'lucide-react'
  import { Link, useNavigate, useLocation } from 'react-router'
  import { useStore } from '@/lib/store'
  import type { Tab } from '@/lib/store'
  import { usePermission } from '@/hooks/usePermission'
  import { visibleMainTabKeys } from '@/lib/permissions'

  const allMainTabs: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { key: 'home', label: 'HOME', icon: LayoutGrid },
    { key: 'stock', label: 'STOCK', icon: Package },
    { key: 'debts', label: 'DEBTS', icon: ScrollText },
    { key: 'reports', label: 'REPORT', icon: BarChart3 },
  ]
  ```
  Then inside `export default function BottomNav()`, replace:
  ```ts
    const { state, setTab, dispatch } = useStore()
    const navigate = useNavigate()
    const location = useLocation()
  ```
  with:
  ```ts
    const { state, setTab, dispatch } = useStore()
    const { role } = usePermission()
    const navigate = useNavigate()
    const location = useLocation()
    const mainTabs = allMainTabs.filter((t) => visibleMainTabKeys(role).includes(t.key))
  ```
  (The `.map((item) => { ... })` below already iterates the local `mainTabs` variable, so no further change is needed there.)

  Modify `src/App.tsx`. Add the import (after `import { useStore } from '@/lib/store'`):
  ```ts
  import { usePermission } from '@/hooks/usePermission'
  ```
  Inside `MainApp()`, replace:
  ```ts
    const { state } = useStore()
    const [showSalesHistory, setShowSalesHistory] = useState(false)
    const [showExpenses, setShowExpenses] = useState(false)
    const [showCustomers, setShowCustomers] = useState(false)
    const [agentOpen, setAgentOpen] = useState(false)

    // Automatically close overlays when the active tab changes
    useEffect(() => {
      setShowSalesHistory(false)
      setShowExpenses(false)
      setShowCustomers(false)
    }, [state.activeTab])
  ```
  with:
  ```ts
    const { state, setTab } = useStore()
    const { canView } = usePermission()
    const [showSalesHistory, setShowSalesHistory] = useState(false)
    const [showExpenses, setShowExpenses] = useState(false)
    const [showCustomers, setShowCustomers] = useState(false)
    const [agentOpen, setAgentOpen] = useState(false)

    // Automatically close overlays when the active tab changes
    useEffect(() => {
      setShowSalesHistory(false)
      setShowExpenses(false)
      setShowCustomers(false)
    }, [state.activeTab])

    // Defense in depth: if a role loses Reports access (or a stale tab
    // selection survives a role change), bounce back to Home instead of
    // rendering a tab BottomNav no longer shows a link for.
    useEffect(() => {
      if (state.activeTab === 'reports' && !canView('reports')) setTab('home')
    }, [state.activeTab, canView, setTab])
  ```
  Then in `export default function App()`, replace the `/cash` and `/capital`/`/capital/:id` routes:
  ```tsx
          <Route
            path="/capital"
            element={state.isAuthenticated ? (
              <div className="h-full w-full overflow-y-auto bg-sand relative"><Capital /></div>
            ) : <Navigate to="/login" replace />}
          />
          <Route
            path="/capital/:id"
            element={state.isAuthenticated ? (
              <div className="h-full w-full overflow-y-auto bg-sand relative"><InjectionDetail /></div>
            ) : <Navigate to="/login" replace />}
          />
          <Route
            path="/cash"
            element={state.isAuthenticated ? (
              <div className="h-full w-full overflow-y-auto bg-sand relative"><CashFlow /></div>
            ) : <Navigate to="/login" replace />}
          />
  ```
  with:
  ```tsx
          <Route
            path="/capital"
            element={
              !state.isAuthenticated ? <Navigate to="/login" replace />
              : !canView('capital') ? <Navigate to="/" replace />
              : <div className="h-full w-full overflow-y-auto bg-sand relative"><Capital /></div>
            }
          />
          <Route
            path="/capital/:id"
            element={
              !state.isAuthenticated ? <Navigate to="/login" replace />
              : !canView('capital') ? <Navigate to="/" replace />
              : <div className="h-full w-full overflow-y-auto bg-sand relative"><InjectionDetail /></div>
            }
          />
          <Route
            path="/cash"
            element={
              !state.isAuthenticated ? <Navigate to="/login" replace />
              : !canView('cashFlow') ? <Navigate to="/" replace />
              : <div className="h-full w-full overflow-y-auto bg-sand relative"><CashFlow /></div>
            }
          />
  ```
  This requires `canView` inside `export default function App()` too — add at the top of that function (it currently only has `const { state } = useStore()`):
  ```ts
  export default function App() {
    const { state } = useStore()
    const { canView } = usePermission()
  ```

  Modify `src/pages/Dashboard.tsx`. Add the import (after `import type { Sale } from '@/lib/supabase'`):
  ```ts
  import { usePermission } from '@/hooks/usePermission'
  ```
  Inside `export default function Dashboard(...)`, replace:
  ```ts
    const { state, t, setTab } = useStore()
  ```
  with:
  ```ts
    const { state, t, setTab } = useStore()
    const { canView } = usePermission()
  ```
  Replace the Quick Actions section's Expenses button, Capital card, and Cash Flow button:
  ```tsx
          <button
            onClick={onOpenExpenses}
            className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
          >
            <ExpenseIcon size={24} className="text-accent-red" />
            <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Expenses</span>
          </button>
          <button
            onClick={onOpenCustomers}
            className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Customers</span>
          </button>
          <CapitalSummaryCard />
          <button
            onClick={() => navigate('/cash')}
            className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
          >
            <Wallet size={24} className="text-ink" />
            <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Cash<br/>Flow</span>
  ```
  with:
  ```tsx
          {canView('expenses') && (
            <button
              onClick={onOpenExpenses}
              className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
            >
              <ExpenseIcon size={24} className="text-accent-red" />
              <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Expenses</span>
            </button>
          )}
          <button
            onClick={onOpenCustomers}
            className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Customers</span>
          </button>
          {canView('capital') && <CapitalSummaryCard />}
          {canView('cashFlow') && (
            <button
              onClick={() => navigate('/cash')}
              className="btn-tactile bg-warm-gray rounded-sm px-3 py-3 flex flex-col items-center gap-2"
            >
              <Wallet size={24} className="text-ink" />
              <span className="font-display text-[10px] text-ink uppercase tracking-wider text-center leading-tight">Cash<br/>Flow</span>
  ```
  (the closing `</button>` two lines below stays as-is, now inside the new `{canView('cashFlow') && (...)}` block).
  Also gate the bank-balance link in the hero section — replace:
  ```tsx
          <button
            onClick={() => navigate('/cash')}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-text active:opacity-60"
          >
            <span className="font-display text-ink">{formatCurrency(state.bankBalance)}</span> in bank →
          </button>
  ```
  with:
  ```tsx
          {canView('cashFlow') && (
            <button
              onClick={() => navigate('/cash')}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-text active:opacity-60"
            >
              <span className="font-display text-ink">{formatCurrency(state.bankBalance)}</span> in bank →
            </button>
          )}
  ```

- [ ] **Step 4: Run the manual verification checklist to confirm it passes**
  Since this repo has no component-test harness (no RTL/jsdom), verify by running the app (`npm run dev`) and logging in as each seeded test role from Task 1's checklist (or temporarily forcing `state.role` via the React DevTools console for a quick check):
  - Owner: BottomNav shows HOME/STOCK/DEBTS/REPORT; Dashboard shows Expenses, Capital card, Cash Flow button, and the "in bank" link; `/cash` and `/capital` load normally.
  - Manager: same as Owner (Manager retains Reports/Expenses) except Cash Flow button, Capital card, and "in bank" link are hidden; navigating directly to `/cash` or `/capital` in the address bar redirects to `/`.
  - Staff: BottomNav shows only HOME/STOCK/DEBTS (no REPORT tab); Expenses button, Capital card, Cash Flow button, and "in bank" link are all hidden; `/cash`, `/capital`, and `/reports` (via tab) are all unreachable.
  Also run the full test suite to confirm no regressions from the edited files:
  ```bash
  npx vitest run
  ```
  Expected: all suites pass (no new Vitest coverage was added in this task, by design — see Step 1).

- [ ] **Step 5: Commit**
  ```bash
  git add src/components/BottomNav.tsx src/App.tsx src/pages/Dashboard.tsx
  git commit -m "Gate Reports tab and Cash/Capital/Expenses entry points by role"
  ```

---

### Task 11: `invite-staff` edge function

**Files:**
- Create: `supabase/functions/invite-staff/index.ts`
- Modify: `supabase/config.toml` (append after the `[functions.serwaa-sales-vision]` block)
- Test: manual `curl` checklist (this repo has zero Deno test infra — see Global Constraints).

**Interfaces:**
- Consumes: `business_profiles`, `business_members` (Task 1); `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` env vars (existing, same as `admin-impersonate`).
- Produces: `POST /functions/v1/invite-staff` accepting `{ userJwt, email, role }`, returning `{ ok: true }` or `{ error, detail? }` — consumed by Task 12's `staffApi.inviteStaff()`.

- [ ] **Step 1: State the failing expectation**
  Before creating the function, confirm the endpoint doesn't exist:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    "https://qumttowvyujqaubyshjq.supabase.co/functions/v1/invite-staff" \
    -H "Authorization: Bearer <anon_key>" -H "apikey: <anon_key>" \
    -H "Content-Type: application/json" -d '{}'
  ```
  Expected: `404` (function not deployed yet).

- [ ] **Step 2: Run it to confirm the failure**
  Run the `curl` command above and confirm the `404`.

- [ ] **Step 3: Write minimal implementation**
  Create `supabase/functions/invite-staff/index.ts`:
  ```ts
  // invite-staff: an owner invites a Manager or Staff member as a real Supabase
  // Auth user scoped to their business. Same trust tier as admin-impersonate:
  // service-role key, caller identity re-verified via getUser() (verify_jwt=false
  // because this project uses asymmetric JWT signing keys the edge gateway
  // cannot validate for user tokens — the function validates the caller itself).
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
  import { corsHeaders, json } from '../_shared/cors.ts'

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    try {
      let body: { userJwt?: string; email?: string; role?: string }
      try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }

      const userJwt = body.userJwt
      if (!userJwt) return json({ error: 'Unauthorized' }, 401)
      const userClient = createClient(SUPABASE_URL, ANON_KEY)
      const { data: userData, error: userErr } = await userClient.auth.getUser(userJwt)
      if (userErr || !userData?.user) {
        return json({ error: 'Unauthorized', detail: userErr?.message ?? null }, 401)
      }
      const callerId = userData.user.id

      const email = body.email?.trim().toLowerCase()
      const role = body.role
      if (!email || !email.includes('@')) return json({ error: 'Valid email required' }, 400)
      if (role !== 'manager' && role !== 'staff') return json({ error: "role must be 'manager' or 'staff'" }, 400)
      if (email === userData.user.email?.toLowerCase()) return json({ error: 'cannot invite yourself' }, 400)

      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

      // Authorize: caller must own a business. Staff/Manager cannot invite others.
      const { data: owner, error: ownerErr } = await admin
        .from('business_profiles').select('user_id').eq('user_id', callerId).maybeSingle()
      if (ownerErr) return json({ error: 'server error', detail: ownerErr.message }, 500)
      if (!owner) return json({ error: 'forbidden' }, 403)

      // Upsert the membership row: re-inviting a removed/previously-invited
      // email re-activates it instead of hitting the unique constraint.
      const { error: upsertErr } = await admin
        .from('business_members')
        .upsert(
          { business_id: callerId, invited_email: email, role, status: 'invited', member_user_id: null, joined_at: null },
          { onConflict: 'business_id,invited_email' },
        )
      if (upsertErr) return json({ error: 'could not save invite', detail: upsertErr.message }, 500)

      // Send the Supabase invite email (creates the auth user in an invited state).
      const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email)
      if (inviteErr && !/already registered/i.test(inviteErr.message ?? '')) {
        return json({ error: 'Could not send invite email', detail: inviteErr.message }, 500)
      }

      return json({ ok: true })
    } catch (e) {
      console.error('invite-staff: CRASH', String((e as Error)?.stack ?? e))
      return json({ error: 'server error', detail: String((e as Error)?.message ?? e) }, 500)
    }
  })
  ```
  Append to `supabase/config.toml` (after the `[functions.serwaa-sales-vision]` block):
  ```toml

  # Client-invoked: an owner invites a Manager/Staff member. Re-verifies the
  # caller (getUser + business_profiles ownership) inside the function, so the
  # gateway JWT check is not needed. Same asymmetric-JWT reason as admin-impersonate.
  [functions.invite-staff]
  verify_jwt = false
  ```

- [ ] **Step 4: Run the manual verification checklist to confirm it passes**
  Deploy (`supabase functions deploy invite-staff`), then:
  ```bash
  # 1. Missing auth → 401
  curl -s -w "\n%{http_code}\n" -X POST \
    "https://qumttowvyujqaubyshjq.supabase.co/functions/v1/invite-staff" \
    -H "Authorization: Bearer <anon_key>" -H "apikey: <anon_key>" \
    -H "Content-Type: application/json" -d '{"email":"x@y.com","role":"staff"}'
  # Expected: {"error":"Unauthorized"} \n 401

  # 2. Valid owner JWT, valid body → ok:true (use <owner_access_token> from a real logged-in owner session)
  curl -s -w "\n%{http_code}\n" -X POST \
    "https://qumttowvyujqaubyshjq.supabase.co/functions/v1/invite-staff" \
    -H "Authorization: Bearer <anon_key>" -H "apikey: <anon_key>" \
    -H "Content-Type: application/json" \
    -d '{"userJwt":"<owner_access_token>","email":"newstaff@rbactest.local","role":"staff"}'
  # Expected: {"ok":true} \n 200

  # 3. Confirm the row landed.
  select * from business_members where invited_email = 'newstaff@rbactest.local';
  -- Expected: 1 row, status = 'invited', role = 'staff'

  # 4. Non-owner (e.g. <staff_access_token> from Task 1's seeded staff user) → 403
  curl -s -w "\n%{http_code}\n" -X POST \
    "https://qumttowvyujqaubyshjq.supabase.co/functions/v1/invite-staff" \
    -H "Authorization: Bearer <anon_key>" -H "apikey: <anon_key>" \
    -H "Content-Type: application/json" \
    -d '{"userJwt":"<staff_access_token>","email":"another@rbactest.local","role":"staff"}'
  # Expected: {"error":"forbidden"} \n 403
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add supabase/functions/invite-staff/index.ts supabase/config.toml
  git commit -m "Add invite-staff edge function for owner-initiated Manager/Staff invites"
  ```

---

### Task 12: `staffApi.ts` + Settings "Staff" management UI

**Files:**
- Create: `src/services/staffApi.ts`
- Test: `src/services/staffApi.test.ts`
- Modify: `src/pages/Settings.tsx` (imports, `menuItems`, new modal)

**Interfaces:**
- Consumes: `POST /functions/v1/invite-staff` (Task 11); `usePermission().settingsAccess` (Task 9).
- Produces: `normalizeInviteEmail(raw) => string` (pure, tested); `fetchStaff() => Promise<StaffMember[]>`; `inviteStaff(email, role) => Promise<void>`; `updateStaffRole(id, role) => Promise<void>`; `revokeStaff(id) => Promise<void>` — consumed by `Settings.tsx`'s new Staff section.

- [ ] **Step 1: Write the failing test**
  Create `src/services/staffApi.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { normalizeInviteEmail } from './staffApi'

  describe('normalizeInviteEmail', () => {
    it('trims whitespace and lowercases', () => {
      expect(normalizeInviteEmail('  Ama@Shop.COM  ')).toBe('ama@shop.com')
    })
    it('is a no-op for an already-clean email', () => {
      expect(normalizeInviteEmail('kofi@shop.com')).toBe('kofi@shop.com')
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**
  ```bash
  npx vitest run src/services/staffApi.test.ts
  ```
  Expected: fails with `Cannot find module './staffApi'`.

- [ ] **Step 3: Write minimal implementation**
  Create `src/services/staffApi.ts`:
  ```ts
  import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'

  export interface StaffMember {
    id: string
    business_id: string
    member_user_id: string | null
    invited_email: string
    role: 'manager' | 'staff'
    status: 'invited' | 'active' | 'removed'
    invited_at: string
    joined_at: string | null
  }

  // Pure: normalizes an owner-typed invite email the same way the edge
  // function does server-side, so the list/UI and the DB agree.
  export function normalizeInviteEmail(raw: string): string {
    return raw.trim().toLowerCase()
  }

  export async function fetchStaff(): Promise<StaffMember[]> {
    const { data: userData } = await supabase.auth.getUser()
    const uid = userData.user?.id
    if (!uid) return []
    const { data, error } = await supabase
      .from('business_members')
      .select('*')
      .eq('business_id', uid)
      .neq('status', 'removed')
      .order('invited_at', { ascending: false })
    if (error) throw error
    return (data as StaffMember[]) || []
  }

  export async function inviteStaff(email: string, role: 'manager' | 'staff'): Promise<void> {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-staff`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userJwt: token, email: normalizeInviteEmail(email), role }),
    })
    const data = await res.json().catch(() => ({}) as { error?: string })
    if (!res.ok) throw new Error(data.error || 'Could not send invite')
  }

  export async function updateStaffRole(id: string, role: 'manager' | 'staff'): Promise<void> {
    const { error } = await supabase.from('business_members').update({ role }).eq('id', id)
    if (error) throw error
  }

  export async function revokeStaff(id: string): Promise<void> {
    const { error } = await supabase.from('business_members').update({ status: 'removed' }).eq('id', id)
    if (error) throw error
  }
  ```
  Modify `src/pages/Settings.tsx`. Add imports (after `import type { BusinessProfile } from '@/lib/supabase'`):
  ```ts
  import { usePermission } from '@/hooks/usePermission'
  import { fetchStaff, inviteStaff, updateStaffRole, revokeStaff, type StaffMember } from '@/services/staffApi'
  ```
  Inside `export default function Settings({ onClose }: SettingsProps)`, add state (after `const [saving, setSaving] = useState(false)`):
  ```ts
    const { settingsAccess } = usePermission()
    const [showStaff, setShowStaff] = useState(false)
    const [staff, setStaff] = useState<StaffMember[]>([])
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteRole, setInviteRole] = useState<'manager' | 'staff'>('staff')
    const [inviting, setInviting] = useState(false)

    const loadStaff = async () => {
      try { setStaff(await fetchStaff()) } catch { showToast('Could not load staff', 'error') }
    }

    const handleInvite = async () => {
      if (!inviteEmail.trim()) return
      setInviting(true)
      try {
        await inviteStaff(inviteEmail, inviteRole)
        setInviteEmail('')
        await loadStaff()
        showToast('Invite sent', 'success')
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Could not send invite', 'error')
      } finally {
        setInviting(false)
      }
    }

    const handleRoleChange = async (id: string, role: 'manager' | 'staff') => {
      try { await updateStaffRole(id, role); await loadStaff() } catch { showToast('Could not update role', 'error') }
    }

    const handleRevoke = async (id: string) => {
      try { await revokeStaff(id); await loadStaff() } catch { showToast('Could not revoke access', 'error') }
    }
  ```
  In `menuItems`, add a Staff entry gated to owner-only (`settingsAccess === 'edit'`), right after the existing Super Admin entry:
  ```tsx
    const menuItems = [
      ...(state.isSuperAdmin
        ? [{ icon: Shield, label: 'Super Admin', action: () => navigate('/admin') }]
        : []),
      ...(settingsAccess === 'edit'
        ? [{ icon: User, label: 'Staff', action: () => { setShowStaff(true); loadStaff() } }]
        : []),
      { icon: User, label: 'Edit Profile', action: () => setShowProfile(true) },
  ```
  (Note the pre-existing `Edit Profile` entry already uses the `User` icon — reusing it for `Staff` is intentional and matches this list's existing icon reuse elsewhere, e.g. `Shield` for both Super Admin and Privacy & Security.)

  Add a new modal, placed alongside the existing `AnimatePresence` blocks (e.g. right after the `{/* Confirm Logout */}` block, before the final closing `</div>`):
  ```tsx
        {/* Staff Management Modal */}
        <AnimatePresence>
          {showStaff && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowStaff(false)} />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-50%" }}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[90vw] max-w-sm max-h-[85vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between px-4 py-3 border-b-2 border-ink sticky top-0 bg-sand">
                  <h2 className="font-display text-lg text-ink uppercase">Staff</h2>
                  <button onClick={() => setShowStaff(false)} className="w-8 h-8 flex items-center justify-center rounded-sm bg-warm-gray"><X size={16} /></button>
                </div>
                <div className="p-4 space-y-4">
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-text uppercase tracking-wider">Invite</p>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="staff@example.com"
                      className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as 'manager' | 'staff')}
                      className="w-full h-10 px-3 bg-light harsh-border rounded-sm text-sm"
                    >
                      <option value="staff">Staff</option>
                      <option value="manager">Manager</option>
                    </select>
                    <button
                      onClick={handleInvite}
                      disabled={inviting || !inviteEmail.trim()}
                      className="w-full h-11 bg-ink text-white font-display text-sm uppercase tracking-wider rounded-sm disabled:opacity-50"
                    >
                      {inviting ? '...' : 'Send Invite'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-text uppercase tracking-wider">Team</p>
                    {staff.length === 0 && <p className="text-xs text-muted-text">No staff invited yet.</p>}
                    {staff.map((m) => (
                      <div key={m.id} className="flex items-center gap-2 px-3 py-2.5 bg-light harsh-border rounded-sm">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ink truncate">{m.invited_email}</p>
                          <p className="text-[10px] text-muted-text uppercase">{m.status}</p>
                        </div>
                        <select
                          value={m.role}
                          onChange={(e) => handleRoleChange(m.id, e.target.value as 'manager' | 'staff')}
                          className="h-8 px-2 bg-warm-gray rounded-sm text-xs"
                        >
                          <option value="staff">Staff</option>
                          <option value="manager">Manager</option>
                        </select>
                        <button onClick={() => handleRevoke(m.id)} className="h-8 px-2 bg-accent-red/10 text-accent-red rounded-sm text-xs">
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
  ```

- [ ] **Step 4: Run test to verify it passes**
  ```bash
  npx vitest run src/services/staffApi.test.ts
  ```
  Expected: `2 passed`.
  Then confirm the whole project still compiles:
  ```bash
  npx vitest run
  ```
  Expected: all suites pass. Manually verify in the running app: as Owner, Settings shows a "Staff" row; clicking it lists invited/active members, invite/role-change/revoke round-trip against the real `invite-staff` function and `business_members` table from Task 11. As Manager/Staff, the "Staff" row is absent from the menu.

- [ ] **Step 5: Commit**
  ```bash
  git add src/services/staffApi.ts src/services/staffApi.test.ts src/pages/Settings.tsx
  git commit -m "Add owner-only Staff management UI (invite/list/change-role/revoke)"
  ```

---

### Task 13: `fetchProducts()` cost_price exclusion for Staff

**Files:**
- Modify: `src/services/supabaseApi.ts:22-34` (the `fetchProducts` function), plus its 3 call sites in `src/lib/store.tsx`
- Test: `src/services/supabaseApi.test.ts`

**Interfaces:**
- Consumes: `type Role` (Task 7); `state.role` (Task 8).
- Produces: `maskCostPriceForRole(products, role) => Product[]` (pure, tested); `fetchProducts(role?: Role | null) => Promise<Product[]>` (signature change — old signature was `fetchProducts(): Promise<Product[]>`).

- [ ] **Step 1: Write the failing test**
  Create `src/services/supabaseApi.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { maskCostPriceForRole } from './supabaseApi'
  import type { Product } from '@/lib/supabase'

  const product = (over: Partial<Product> = {}): Product => ({
    id: 'p1', user_id: 'u1', name: 'Rice', cost_price: 50, selling_price: 80,
    quantity: 10, unit: 'bag', units_per_pack: 1, category: 'Groceries',
    low_stock_threshold: 5, created_at: '2026-08-01T00:00:00.000Z', ...over,
  })

  describe('maskCostPriceForRole', () => {
    it('leaves cost_price intact for owner, manager, and unresolved role', () => {
      expect(maskCostPriceForRole([product()], 'owner')[0].cost_price).toBe(50)
      expect(maskCostPriceForRole([product()], 'manager')[0].cost_price).toBe(50)
      expect(maskCostPriceForRole([product()], null)[0].cost_price).toBe(50)
    })
    it('zeroes cost_price for staff without dropping the field', () => {
      const [masked] = maskCostPriceForRole([product()], 'staff')
      expect(masked.cost_price).toBe(0)
      expect(masked.selling_price).toBe(80)
    })
  })
  ```

- [ ] **Step 2: Run test to verify it fails**
  ```bash
  npx vitest run src/services/supabaseApi.test.ts
  ```
  Expected: fails — `maskCostPriceForRole` is not exported from `./supabaseApi` yet.

- [ ] **Step 3: Write minimal implementation**
  Modify `src/services/supabaseApi.ts`. Add the import (after `import { consumeForSale, reverseConsumptions } from '@/services/batchApi'`):
  ```ts
  import type { Role } from '@/lib/permissions'
  ```
  Replace `fetchProducts`:
  ```ts
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
  ```
  with:
  ```ts
  // Staff never receives cost_price from the server; see
  // docs/superpowers/specs/2026-08-03-staff-rbac-design.md §2/§5 for why this
  // one control is app-layer (RLS is row-scoped, not column-scoped).
  const STAFF_SAFE_PRODUCT_COLUMNS =
    'id, user_id, name, selling_price, quantity, unit, pack_unit, units_per_pack, category, low_stock_threshold, barcode, qr_code, created_at, updated_at'

  export async function fetchProducts(role?: Role | null): Promise<Product[]> {
    const uid = await getCurrentUserId()
    if (!uid) return []

    const { data, error } = await supabase
      .from('products')
      .select(role === 'staff' ? STAFF_SAFE_PRODUCT_COLUMNS : '*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })

    if (error) throw error
    return maskCostPriceForRole((data as Product[]) || [], role)
  }

  // Pure: masks cost_price client-side too so every consumer keeps a complete
  // Product shape without ever holding the real value for a Staff caller.
  export function maskCostPriceForRole(products: Product[], role?: Role | null): Product[] {
    if (role !== 'staff') return products
    return products.map((p) => ({ ...p, cost_price: 0 }))
  }
  ```
  Modify `src/lib/store.tsx` — the `fetchProducts(state.role)` call inside `refreshData` was already updated in Task 8's Step 3; now update the two remaining call sites. Replace (inside `addSale`):
  ```ts
        const products = await fetchProducts()
        dispatch({ type: 'SET_PRODUCTS', products })
  ```
  with:
  ```ts
        const products = await fetchProducts(state.role)
        dispatch({ type: 'SET_PRODUCTS', products })
  ```
  Replace (inside `addSaleBatch`):
  ```ts
      const [products, summary] = await Promise.all([fetchProducts(), getDashboardSummary()])
  ```
  with:
  ```ts
      const [products, summary] = await Promise.all([fetchProducts(state.role), getDashboardSummary()])
  ```
  Replace (inside `deleteSale`):
  ```ts
      const [products, summary, customers] = await Promise.all([
        fetchProducts(),
        getDashboardSummary(),
        fetchCustomers(),
      ])
  ```
  with:
  ```ts
      const [products, summary, customers] = await Promise.all([
        fetchProducts(state.role),
        getDashboardSummary(),
        fetchCustomers(),
      ])
  ```

- [ ] **Step 4: Run test to verify it passes**
  ```bash
  npx vitest run src/services/supabaseApi.test.ts
  ```
  Expected: `2 passed`. Then run the full suite (this task touches `store.tsx` call sites again):
  ```bash
  npx vitest run
  ```
  Expected: all suites pass.

- [ ] **Step 5: Commit**
  ```bash
  git add src/services/supabaseApi.ts src/lib/store.tsx
  git commit -m "Exclude cost_price from Staff-role product fetches (app-layer control)"
  ```

---

### Task 14: `serwaa-agent` role-based tool filtering

**Files:**
- Modify: `supabase/functions/serwaa-agent/tools.ts` (append `toolsForRole`)
- Modify: `supabase/functions/serwaa-agent/index.ts:1-11, 50-71`
- Test: manual `curl` checklist (no Deno test infra — see Global Constraints).

**Interfaces:**
- Consumes: `TOOLS` (existing, `supabase/functions/serwaa-agent/tools.ts`); `business_profiles`/`business_members` tables (Task 1).
- Produces: `toolsForRole(role: string | null) => typeof TOOLS[number][]` — consumed by `index.ts`'s Claude request body.

- [ ] **Step 1: State the failing expectation**
  Confirm the agent currently sends the full, unfiltered `TOOLS` list (including `get_summary`, which exposes profit and cash — both restricted for Staff per the matrix) regardless of caller role:
  ```bash
  grep -n "tools: TOOLS" supabase/functions/serwaa-agent/index.ts
  ```
  Expected: 1 match (the unconditional `tools: TOOLS,` line).

- [ ] **Step 2: Run it to confirm the current (pre-fix) behavior**
  Run the `grep` above and confirm the match — this is the "before" state.

- [ ] **Step 3: Write minimal implementation**
  Modify `supabase/functions/serwaa-agent/tools.ts` — append at the end of the file (after the `] as const` closing line):
  ```ts

  // Tool schema filtering by caller role — Staff never gets get_summary (it
  // exposes profit and cash balance, both restricted for Staff per the
  // permission matrix in docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5).
  export function toolsForRole(role: string | null): typeof TOOLS[number][] {
    if (role === 'staff') return TOOLS.filter((tool) => tool.name !== 'get_summary')
    return [...TOOLS]
  }
  ```
  Modify `supabase/functions/serwaa-agent/index.ts`. Replace:
  ```ts
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
  import { corsHeaders, json } from '../_shared/cors.ts'
  import { TOOLS } from './tools.ts'

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
  const MODEL = 'claude-haiku-4-5-20251001'
  ```
  with:
  ```ts
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
  import { corsHeaders, json } from '../_shared/cors.ts'
  import { TOOLS, toolsForRole } from './tools.ts'

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
  const MODEL = 'claude-haiku-4-5-20251001'
  ```
  Replace:
  ```ts
      const userClient = createClient(SUPABASE_URL, ANON_KEY)
      const { data: userData, error: userErr } = await userClient.auth.getUser(body.userJwt)
      if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

      // Keep context small: last 4 turns only.
      const recent = body.messages.slice(-4)
  ```
  with:
  ```ts
      const userClient = createClient(SUPABASE_URL, ANON_KEY)
      const { data: userData, error: userErr } = await userClient.auth.getUser(body.userJwt)
      if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)
      const callerId = userData.user.id

      // Resolve the caller's role (service role bypasses RLS) so the tool
      // schema can be filtered per docs/superpowers/specs/2026-08-03-staff-rbac-design.md §5.
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
      const { data: owner } = await admin
        .from('business_profiles').select('user_id').eq('user_id', callerId).maybeSingle()
      let role: string | null = owner ? 'owner' : null
      if (!role) {
        const { data: member } = await admin
          .from('business_members').select('role').eq('member_user_id', callerId).eq('status', 'active').maybeSingle()
        role = (member?.role as string) ?? null
      }

      // Keep context small: last 4 turns only.
      const recent = body.messages.slice(-4)
  ```
  Replace:
  ```ts
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: systemPrompt(body.snapshot),
        tools: TOOLS,
        messages: recent.map((m) => ({ role: m.role, content: m.content })),
      }),
  ```
  with:
  ```ts
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: systemPrompt(body.snapshot),
        tools: toolsForRole(role),
        messages: recent.map((m) => ({ role: m.role, content: m.content })),
      }),
  ```

- [ ] **Step 4: Run the manual verification checklist to confirm it passes**
  Deploy (`supabase functions deploy serwaa-agent`), then send a message that would trigger `get_summary` (e.g. "what's my profit today") as each role's access token and inspect the request Claude actually received (or temporarily log `role` and `toolsForRole(role).map(t => t.name)` server-side during manual testing):
  ```bash
  # As STAFF: the agent must fall back to a plain reply (or say it can't answer)
  # instead of calling get_summary, since that tool is no longer in its schema.
  curl -s -X POST "https://qumttowvyujqaubyshjq.supabase.co/functions/v1/serwaa-agent" \
    -H "Authorization: Bearer <anon_key>" -H "apikey: <anon_key>" -H "Content-Type: application/json" \
    -d '{"userJwt":"<staff_access_token>","messages":[{"role":"user","content":"what is my profit today"}],"snapshot":{}}'
  # Expected: response JSON's toolCalls array never contains {"name":"get_summary",...}

  # As OWNER: the same question DOES trigger get_summary.
  curl -s -X POST "https://qumttowvyujqaubyshjq.supabase.co/functions/v1/serwaa-agent" \
    -H "Authorization: Bearer <anon_key>" -H "apikey: <anon_key>" -H "Content-Type: application/json" \
    -d '{"userJwt":"<owner_access_token>","messages":[{"role":"user","content":"what is my profit today"}],"snapshot":{}}'
  # Expected: response JSON's toolCalls array contains a {"name":"get_summary",...} entry
  ```

- [ ] **Step 5: Commit**
  ```bash
  git add supabase/functions/serwaa-agent/tools.ts supabase/functions/serwaa-agent/index.ts
  git commit -m "Filter serwaa-agent tool schema by caller role (Staff loses get_summary)"
  ```

---

### Task 15: End-to-end manual verification

**Files:**
- None (verification-only task; no code changes).

**Interfaces:**
- Consumes: everything from Tasks 1–14.
- Produces: a signed-off confirmation that the feature works end-to-end per the design spec's §7 testing section.

- [ ] **Step 1: State what "done" means**
  Per `docs/superpowers/specs/2026-08-03-staff-rbac-design.md` §7: invite a real Manager and a real Staff account, confirm each sees exactly the nav/tabs/data the §5 matrix specifies, and confirm a Staff session calling `capital_injections` directly via dev tools gets an empty/denied result from RLS — not merely a hidden UI element. This is the acceptance bar; nothing has been signed off until every checklist item below passes.

- [ ] **Step 2: Confirm the pre-conditions**
  Confirm Tasks 1–14 are all committed and deployed (migrations run in the SQL Editor in order 023→027; `invite-staff` and `serwaa-agent` edge functions deployed; frontend built/deployed or running locally against the same Supabase project).

- [ ] **Step 3: Run the checklist**
  Using a real owner account (or the seeded `<owner_uid>` from Task 1):
  1. Settings → Staff → Invite `manager-e2e@rbactest.local` as Manager, and `staff-e2e@rbactest.local` as Staff.
  2. Accept both invite emails (set password, log in) — confirm each lands authenticated and `business_members` flips to `status='active'` with `member_user_id` set and `joined_at` populated for both rows:
     ```sql
     select invited_email, role, status, member_user_id, joined_at from business_members
       where business_id = '<owner_uid>' order by invited_at desc;
     -- Expected: both rows status='active', member_user_id not null, joined_at not null
     ```
  3. As **Manager**: BottomNav shows HOME/STOCK/DEBTS/REPORT; can record a sale, add/edit stock, view customers/debts, view Expenses and Reports (with cost_price/profit visible); Cash Flow button and Capital card are hidden on Dashboard; navigating to `/cash` or `/capital` redirects to `/`; Settings shows business info read-only (no Save button reachable) and no "Staff" menu entry.
  4. As **Staff**: BottomNav shows only HOME/STOCK/DEBTS; can record a sale, add/edit stock (no cost_price visible on any product), view customers/debts; Expenses button, Reports tab, Cash Flow button, and Capital card are all absent; Settings has no Staff entry and no business-profile section at all.
  5. As **Staff**, open browser dev tools and issue a direct REST call bypassing the UI entirely:
     ```
     GET https://qumttowvyujqaubyshjq.supabase.co/rest/v1/capital_injections?select=*
     Headers: apikey: <anon_key>, Authorization: Bearer <staff_access_token>
     ```
     Expected: `200 OK` with body `[]` (RLS silently filters every row — not a UI-only restriction).
  6. As **Owner**, revoke the Staff account (Settings → Staff → Revoke). Immediately re-run the Staff account's existing authenticated session against `GET /rest/v1/products?select=*`:
     Expected: `200 OK` with body `[]` (access is cut instantly via `business_id_for()` re-evaluating to `NULL` on every request — no token/session invalidation needed, matching spec §4 point 4).
  7. Confirm `npx vitest run` still passes in full (final regression check across every task's tests):
     ```bash
     npx vitest run
     ```
     Expected: all suites pass.

- [ ] **Step 4: Record the result**
  If every item in Step 3 passed, the feature is verified end-to-end. If any item failed, file it as a bug against the specific task above (do not silently patch around it here) and re-run this task after the fix.

- [ ] **Step 5: No commit**
  This task makes no code changes — nothing to commit. If Step 3 uncovered a fix, that fix belongs to whichever earlier task owns the affected file, committed there.

---
