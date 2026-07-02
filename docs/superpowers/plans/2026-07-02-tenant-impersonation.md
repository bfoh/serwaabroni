# Super-Admin Tenant Impersonation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super-admin log in as any tenant with full read+write access to the tenant's whole app, with a persistent exit banner and an audit trail.

**Architecture:** A Supabase edge function verifies super-admin server-side and mints a real tenant session (magic-link `hashed_token`). The client saves its admin session, calls `verifyOtp` to become the tenant, and later restores the admin session to exit. Start/stop events are written to an `impersonation_events` audit table. The whole app "just works" as the tenant because `supabase.auth`'s user genuinely becomes the tenant — no data-layer changes.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest (node env — pure tests only), Supabase JS v2, Supabase Edge Functions (Deno), Postgres RLS.

## Global Constraints

- `SUPABASE_SERVICE_ROLE_KEY` is used ONLY inside the edge function (already set for `send-notification`). Never import it client-side.
- Super-admin status is re-verified server-side on every impersonation call; the client `state.isSuperAdmin` is convenience only.
- Admin session backup lives in `localStorage['sb-admin-backup']` as JSON `{ access_token, refresh_token, tenantName }`.
- Money/format via `formatCurrency` from `src/lib/data.ts`.
- Vitest environment is `node` (see `vitest.config.ts`) — tests must not touch `localStorage`/DOM; test pure functions only.
- Edge functions live under `supabase/functions/<name>/index.ts` and use `../_shared/cors.ts` (`corsHeaders`, `json`).
- Typecheck with `npm run build`; run tests with `npm test`.

---

### Task 1: Audit table + stop RPC (migration)

**Files:**
- Create: `src/db/migration_021_impersonation_events.sql`

**Interfaces:**
- Produces: table `impersonation_events(id, admin_id, tenant_id, action, created_at)`; RPC `admin_log_impersonation_stop()`.

- [ ] **Step 1: Write the migration**

Create `src/db/migration_021_impersonation_events.sql`:

```sql
-- migration_021: impersonation audit trail.
-- Records when a super-admin starts/stops acting as a tenant.
-- Run AFTER migration_005 (needs is_super_admin()).

CREATE TABLE IF NOT EXISTS impersonation_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('start','stop')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE impersonation_events ENABLE ROW LEVEL SECURITY;

-- Admins may read the audit trail. Inserts come from the service role (start,
-- in the edge function) or the SECURITY DEFINER RPC below (stop).
CREATE POLICY "Super admin reads impersonation events"
  ON impersonation_events FOR SELECT USING (is_super_admin(auth.uid()));

-- Stop event is logged from the client while the TENANT session is active, so
-- it cannot rely on is_super_admin(auth.uid()). This SECURITY DEFINER function
-- closes the most recent open 'start' for the current (tenant) user.
CREATE OR REPLACE FUNCTION admin_log_impersonation_stop()
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid;
BEGIN
  SELECT admin_id INTO v_admin
    FROM impersonation_events
    WHERE tenant_id = auth.uid() AND action = 'start'
    ORDER BY created_at DESC LIMIT 1;
  IF v_admin IS NULL THEN RETURN; END IF;
  INSERT INTO impersonation_events (admin_id, tenant_id, action)
    VALUES (v_admin, auth.uid(), 'stop');
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add src/db/migration_021_impersonation_events.sql
git commit -m "feat(db): impersonation audit table + stop RPC"
```

> Ops: apply this SQL in the Supabase SQL editor before testing live.

---

### Task 2: Edge function `admin-impersonate`

**Files:**
- Create: `supabase/functions/admin-impersonate/index.ts`

**Interfaces:**
- Consumes: `super_admins` table; `impersonation_events` (Task 1).
- Produces: HTTP endpoint invoked as `supabase.functions.invoke('admin-impersonate', { body: { tenantId } })`, returning `{ token_hash: string }` on success.

- [ ] **Step 1: Write the function**

Create `supabase/functions/admin-impersonate/index.ts`:

```ts
// admin-impersonate: a super-admin mints a real tenant session to act as them.
// Verifies the caller is a super-admin (service-role check), generates a magic
// link for the tenant (no email sent), logs a 'start' audit row, and returns the
// hashed_token the client exchanges via supabase.auth.verifyOtp.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  // Identify the caller from their JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)
  const callerId = userData.user.id

  let body: { tenantId?: string }
  try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const tenantId = body.tenantId
  if (!tenantId) return json({ error: 'tenantId required' }, 400)
  if (tenantId === callerId) return json({ error: 'cannot impersonate yourself' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Authorize: caller must be a super-admin.
  const { data: sa } = await admin
    .from('super_admins').select('user_id').eq('user_id', callerId).maybeSingle()
  if (!sa) return json({ error: 'forbidden' }, 403)

  // Resolve tenant email.
  const { data: tenant, error: tErr } = await admin.auth.admin.getUserById(tenantId)
  if (tErr || !tenant?.user?.email) return json({ error: 'tenant not found' }, 400)

  // Mint a magic-link session (generateLink does NOT send an email).
  const { data: link, error: lErr } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: tenant.user.email,
  })
  if (lErr || !link?.properties?.hashed_token) {
    return json({ error: 'could not mint session' }, 500)
  }

  // Audit start (service role bypasses RLS).
  await admin.from('impersonation_events')
    .insert({ admin_id: callerId, tenant_id: tenantId, action: 'start' })

  return json({ token_hash: link.properties.hashed_token })
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/admin-impersonate/index.ts
git commit -m "feat(edge): admin-impersonate function mints tenant session"
```

> Ops: `supabase functions deploy admin-impersonate` before testing live.

---

### Task 3: Admin API client functions (TDD for the pure parser)

**Files:**
- Modify: `src/services/adminApi.ts`
- Test: `src/services/adminApi.test.ts` (create)

**Interfaces:**
- Consumes: `supabase` client; edge function (Task 2); RPC `admin_log_impersonation_stop` (Task 1).
- Produces:
  - `type AdminBackup = { access_token: string; refresh_token: string; tenantName: string }`
  - `parseAdminBackup(raw: string | null): AdminBackup | null`
  - `readAdminBackup(): AdminBackup | null`
  - `impersonateTenant(tenantId: string, tenantName: string): Promise<void>`
  - `stopImpersonation(): Promise<void>`
  - `ADMIN_BACKUP_KEY = 'sb-admin-backup'`

- [ ] **Step 1: Write the failing test**

Create `src/services/adminApi.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseAdminBackup } from './adminApi'

describe('parseAdminBackup', () => {
  it('parses a valid backup', () => {
    const raw = JSON.stringify({ access_token: 'a', refresh_token: 'r', tenantName: 'Shop' })
    expect(parseAdminBackup(raw)).toEqual({ access_token: 'a', refresh_token: 'r', tenantName: 'Shop' })
  })
  it('returns null for null/empty', () => {
    expect(parseAdminBackup(null)).toBeNull()
    expect(parseAdminBackup('')).toBeNull()
  })
  it('returns null for malformed JSON', () => {
    expect(parseAdminBackup('{not json')).toBeNull()
  })
  it('returns null when a required field is missing or wrong type', () => {
    expect(parseAdminBackup(JSON.stringify({ access_token: 'a', refresh_token: 'r' }))).toBeNull()
    expect(parseAdminBackup(JSON.stringify({ access_token: 1, refresh_token: 'r', tenantName: 'S' }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- adminApi`
Expected: FAIL — `parseAdminBackup` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `src/services/adminApi.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- adminApi`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/adminApi.ts src/services/adminApi.test.ts
git commit -m "feat(admin): impersonate/stop client API + backup parser"
```

---

### Task 4: Store integration (state, actions, recompute on auth change)

**Files:**
- Modify: `src/lib/store.tsx`

**Interfaces:**
- Consumes: `impersonateTenant`, `stopImpersonation`, `readAdminBackup` from `src/services/adminApi.ts` (Task 3).
- Produces on the store context: `state.impersonating: { tenantId: string; tenantName: string } | null`, `enterImpersonation(tenantId: string, tenantName: string): Promise<void>`, `exitImpersonation(): Promise<void>`.

- [ ] **Step 1: Add state field to the interface**

In `src/lib/store.tsx`, in `interface AppState`, after `suspended: boolean` (line ~61) add:

```ts
  impersonating: { tenantId: string; tenantName: string } | null
```

- [ ] **Step 2: Add the action type**

After `| { type: 'SET_SUSPENDED'; value: boolean }` (line ~99) add:

```ts
  | { type: 'SET_IMPERSONATING'; value: { tenantId: string; tenantName: string } | null }
```

- [ ] **Step 3: Initialise it**

In `initialState`, alongside `isSuperAdmin: false,` add:

```ts
  impersonating: null,
```

- [ ] **Step 4: Handle the action in the reducer**

Next to `case 'SET_SUPER_ADMIN': return { ...state, isSuperAdmin: action.value }` add:

```ts
    case 'SET_IMPERSONATING': return { ...state, impersonating: action.value }
```

- [ ] **Step 5: Import the admin API helpers**

Update the existing import from `@/services/adminApi` (currently `import { amISuperAdmin } from '@/services/adminApi'`, line ~21) to:

```ts
import { amISuperAdmin, impersonateTenant, stopImpersonation, readAdminBackup } from '@/services/adminApi'
```

- [ ] **Step 6: Recompute impersonating on auth changes**

In the `onAuthStateChange` handler (line ~250), inside the `if (session?.user) { ... }` branch, after the `dispatch({ type: 'SET_USER', ... })` call, add:

```ts
        const backup = readAdminBackup()
        dispatch({
          type: 'SET_IMPERSONATING',
          value: backup ? { tenantId: session.user.id, tenantName: backup.tenantName } : null,
        })
```

And in the `else` branch (no session), alongside `dispatch({ type: 'SET_USER', user: null })` add:

```ts
        dispatch({ type: 'SET_IMPERSONATING', value: null })
```

- [ ] **Step 7: Add enter/exit callbacks**

Near the other `useCallback` actions (e.g. just above `logout` at line ~758) add:

```ts
  const enterImpersonation = useCallback(async (tenantId: string, tenantName: string) => {
    await impersonateTenant(tenantId, tenantName)
    // onAuthStateChange (SIGNED_IN from verifyOtp) refreshes user + impersonating.
  }, [])

  const exitImpersonation = useCallback(async () => {
    await stopImpersonation()
    // onAuthStateChange (from setSession) restores admin + clears impersonating.
  }, [])
```

- [ ] **Step 8: Expose them on the context type**

In `interface StoreContextType` (line ~209), after `logout: () => Promise<void>` add:

```ts
  enterImpersonation: (tenantId: string, tenantName: string) => Promise<void>
  exitImpersonation: () => Promise<void>
```

- [ ] **Step 9: Provide them in the context value**

In the `StoreContext.Provider value={{ ... }}` object (line ~806), add `enterImpersonation, exitImpersonation,` alongside `logout,`.

- [ ] **Step 10: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/store.tsx
git commit -m "feat(store): impersonation state + enter/exit actions"
```

---

### Task 5: Impersonation banner + render in the app shell

**Files:**
- Create: `src/components/ImpersonationBanner.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `state.impersonating`, `exitImpersonation` from the store (Task 4).

- [ ] **Step 1: Create the banner component**

Create `src/components/ImpersonationBanner.tsx`:

```tsx
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { useStore } from '@/lib/store'

export default function ImpersonationBanner() {
  const { state, exitImpersonation, showToast } = useStore()
  const [exiting, setExiting] = useState(false)
  if (!state.impersonating) return null

  const exit = async () => {
    setExiting(true)
    try {
      await exitImpersonation()
    } catch {
      showToast('Could not exit — please log in again', 'error')
    } finally {
      setExiting(false)
    }
  }

  return (
    <div className="flex-shrink-0 bg-accent-red text-white px-4 py-2 pt-safe flex items-center justify-between gap-3 z-50 relative">
      <p className="text-xs font-medium truncate">
        ⚠ Acting as {state.impersonating.tenantName} — changes save to their shop
      </p>
      <button
        onClick={exit}
        disabled={exiting}
        className="btn-tactile flex-shrink-0 bg-white/20 rounded-sm px-3 py-1 text-xs font-display uppercase flex items-center gap-1 disabled:opacity-50"
      >
        <LogOut size={13} /> {exiting ? '...' : 'Exit'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Import it in App.tsx**

In `src/App.tsx`, after `import AdminConsole from '@/pages/AdminConsole'` (line 18) add:

```tsx
import ImpersonationBanner from '@/components/ImpersonationBanner'
```

- [ ] **Step 3: Show the banner on the suspended screen too**

Replace the suspended early-return (lines 101-103) with:

```tsx
  if (state.isAuthenticated && state.suspended && !state.isSuperAdmin) {
    return (
      <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden">
        <ImpersonationBanner />
        <div className="flex-1 overflow-hidden"><SuspendedScreen /></div>
      </div>
    )
  }
```

(An admin impersonating a suspended tenant still gets an Exit button.)

- [ ] **Step 4: Render the banner in the main shell**

In the main authenticated return, add the banner as the FIRST child of the outer flex column. Change:

```tsx
  return (
    <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-hidden relative">
```

to:

```tsx
  return (
    <div className="h-[100dvh] w-full bg-sand flex flex-col overflow-hidden relative">
      <ImpersonationBanner />
      <div className="flex-1 overflow-hidden relative">
```

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ImpersonationBanner.tsx src/App.tsx
git commit -m "feat(ui): impersonation banner with exit, shown app-wide"
```

---

### Task 6: Impersonate button in AdminConsole

**Files:**
- Modify: `src/pages/AdminConsole.tsx`

**Interfaces:**
- Consumes: `enterImpersonation`, `state.user` from the store (Task 4).

- [ ] **Step 1: Pull the store bits + icon**

In `src/pages/AdminConsole.tsx`, change the store hook line (line ~24) from:

```tsx
  const { showToast } = useStore()
```

to:

```tsx
  const { showToast, state, enterImpersonation } = useStore()
```

And add `LogIn` to the lucide import (line 3):

```tsx
import { ArrowLeft, Search, Shield, Ban, Trash2, Eye, Loader2, LogIn } from 'lucide-react'
```

- [ ] **Step 2: Add the impersonate handler**

Inside the `AdminConsole` component, next to the other actions (e.g. after `load()` / `toggleSuspend`), add:

```tsx
  async function impersonate(t: TenantRow) {
    if (t.user_id === state.user?.id) return
    if (!confirm(`Log in as "${t.business_name}"? All changes will save to their shop.`)) return
    setBusyId(t.user_id)
    try {
      await enterImpersonation(t.user_id, t.business_name)
      navigate('/')
    } catch (e) {
      showToast(adminErr(e, 'Could not impersonate'), 'error')
      setBusyId(null)
    }
  }
```

- [ ] **Step 3: Add the button to the tenant action row**

In the tenant card action row (`<div className="flex gap-2 mt-3">` … containing View/Suspend/Delete), add an Impersonate button as a new full-width row directly AFTER that div's closing `</div>`:

```tsx
                <button
                  onClick={() => impersonate(t)}
                  disabled={busyId === t.user_id || t.user_id === state.user?.id}
                  className="btn-tactile w-full h-8 mt-2 bg-ink text-white rounded-sm text-xs flex items-center justify-center gap-1 disabled:opacity-40"
                >
                  <LogIn size={13} /> {t.user_id === state.user?.id ? 'This is you' : 'Impersonate'}
                </button>
```

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual verification (requires deployed fn + migration + super_admin row)**

1. As a super-admin, open `/admin`, tap **Impersonate** on a tenant → confirm.
2. App navigates to `/` and shows the tenant's dashboard/stock; a red banner reads "Acting as <shop>".
3. Add a sale → it records under the tenant.
4. Tap **Exit** → returns to admin session and `/admin`.
5. In Supabase, `impersonation_events` has a matching `start` then `stop` row.
6. The Impersonate button on your own row is disabled ("This is you").
7. Refresh mid-impersonation → still the tenant, banner still present, Exit still works.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AdminConsole.tsx
git commit -m "feat(admin): impersonate button on tenant rows"
```

---

## Self-Review

**Spec coverage:**
- Full act-as via minted tenant session → Task 2 (edge fn) + Task 3 (`impersonateTenant`/`verifyOtp`).
- Whole app as tenant → session swap means `uid` becomes tenant; no data changes needed. ✓
- Exit / restore admin → Task 3 (`stopImpersonation` + `setSession`) + Task 5 (banner Exit).
- Audit start/stop → Task 1 (table + RPC), Task 2 (start insert), Task 3 (stop RPC call).
- Server-side super-admin re-check + self-block → Task 2. ✓
- Banner app-wide incl. suspended screen → Task 5 Steps 3–4.
- Impersonate button, disabled on own row → Task 6.
- Ops steps (migration, deploy, super_admins row) → notes in Tasks 1, 2 and Task 6 Step 5.

**Placeholder scan:** No TBD/TODO. Every code step shows full code. Manual-verification steps are concrete numbered checks (no unit test is possible for edge-fn/auth in a node Vitest env; the one pure function — `parseAdminBackup` — is TDD-tested in Task 3).

**Type consistency:** `AdminBackup { access_token, refresh_token, tenantName }`, `parseAdminBackup(raw)`, `readAdminBackup()`, `impersonateTenant(tenantId, tenantName)`, `stopImpersonation()`, `state.impersonating { tenantId, tenantName }`, `SET_IMPERSONATING`, `enterImpersonation(tenantId, tenantName)`, `exitImpersonation()`, edge return `{ token_hash }` — all identical across definition (Tasks 2–4) and use (Tasks 4–6). `verifyOtp({ type: 'magiclink', token_hash })` matches the edge function's `hashed_token` return.
