# Super-Admin Tenant Impersonation — Design

**Date:** 2026-07-02
**Status:** Approved design, pending implementation plan

## Problem

A super-admin (platform owner) can already list all tenants and suspend/delete
them via `/admin` (migration_005 + `AdminConsole.tsx`). What is missing is the
ability to **impersonate** a tenant: log in as them and operate their whole app
(dashboard, inventory, sales, debts, cash) with full **read + write** access, as
if the tenant were signed in.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Power | **Full act-as (read + write)** — not read-only view. |
| Scope | **Whole app as them** — full app shell renders the tenant's data. |
| Mechanism | Mint a **real tenant session** via a Supabase edge function (service_role). |
| Audit | Record impersonation **start** and **stop** events. |

## What already exists (reuse, do not rebuild)

- `super_admins` table + `is_super_admin()`, `am_i_super_admin()` (migration_005).
- `state.isSuperAdmin` set on load (`store.tsx` calls `amISuperAdmin()`), `/admin`
  route gated on it (`App.tsx`).
- `AdminConsole.tsx` lists tenants (`admin_list_tenants`) with suspend/delete.
- Edge-function precedent: `supabase/functions/send-notification/index.ts`
  (JWT → caller uid via anon client; service_role client for privileged ops;
  `_shared/cors.ts` helpers).

## Core mechanism: mint a real tenant session

Because the app scopes every read/write to `supabase.auth`'s current user, the
cleanest way to get full read+write as a tenant is to **swap the client's auth
session** to a genuine session for the tenant user. No data-layer refactor is
needed — `uid` becomes the tenant's.

### Edge function `admin-impersonate`

Mirrors `send-notification`'s structure.

Environment (already configured for send-notification):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Request (POST, `supabase.functions.invoke('admin-impersonate', { body })`):
```ts
{ tenantId: string }
```

Flow:
1. Handle `OPTIONS` (CORS). Reject non-POST with 405.
2. `userClient = createClient(URL, ANON_KEY, { global: { headers: { Authorization }}})`
   → `userClient.auth.getUser()` → `callerId`. Missing/invalid → 401.
3. `admin = createClient(URL, SERVICE_ROLE_KEY)`.
4. **Authorize:** `admin.from('super_admins').select('user_id').eq('user_id', callerId).maybeSingle()`.
   Not found → 403 `{ error: 'forbidden' }`.
5. **Guard:** `tenantId === callerId` → 400 `{ error: 'cannot impersonate yourself' }`.
6. Resolve tenant email: `admin.auth.admin.getUserById(tenantId)`; no email → 400.
7. Mint: `admin.auth.admin.generateLink({ type: 'magiclink', email })`.
   Take `data.properties.hashed_token`. (generateLink does NOT send an email.)
8. Audit: `admin.from('impersonation_events').insert({ admin_id: callerId, tenant_id: tenantId, action: 'start' })`.
9. Return `json({ token_hash })`.

Errors return `json({ error }, status)` using the shared `json` helper.

### Client: enter impersonation

`adminApi.impersonateTenant(tenantId: string): Promise<void>`:
1. `const { data } = await supabase.auth.getSession()`. Save
   `{ access_token, refresh_token }` to `localStorage['sb-admin-backup']`
   (JSON). This is the admin session, needed to return later.
2. `const { data: fn, error } = await supabase.functions.invoke('admin-impersonate', { body: { tenantId } })`.
   Throw on error.
3. `await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: fn.token_hash })`.
   On success the client now holds the **tenant** session; `onAuthStateChange`
   fires and the app reloads the tenant's data.

If step 3 fails, remove the backup key and rethrow (admin session is still
active, no harm).

### Client: exit impersonation

`adminApi.stopImpersonation(): Promise<void>`:
1. Read + parse `localStorage['sb-admin-backup']`. If absent, no-op (not
   impersonating).
2. Best-effort audit stop: `supabase.rpc('admin_log_impersonation_stop')`
   (runs while tenant session is active; see RPC below). Ignore errors.
3. `await supabase.auth.setSession({ access_token, refresh_token })` from the
   backup → admin session restored; `onAuthStateChange` reloads admin context.
4. `localStorage.removeItem('sb-admin-backup')`.

## Store integration

Add to `AppState`: `impersonating: { tenantId: string; tenantName: string } | null`.

- Initial value derived from `localStorage['sb-admin-backup']` presence: if the
  backup exists, we are impersonating. The tenant name comes from the loaded
  `business_profile` after data load; `tenantId` from the current user id.
- Reducer action `SET_IMPERSONATING` sets/clears it.
- On successful `impersonateTenant`, the caller also stashes the target's
  `business_name` (from the tenant row already in `AdminConsole`) so the banner
  can show it immediately. Store it in the backup JSON:
  `{ access_token, refresh_token, tenantName }`.
- On app init and on every `onAuthStateChange`, recompute `impersonating` from
  the backup: present → `{ tenantId: currentUid, tenantName }`, absent → `null`.

Expose from the store context: `enterImpersonation(tenantId, tenantName)` and
`exitImpersonation()` wrapping the adminApi calls + dispatch + navigation.

## UI

### `ImpersonationBanner.tsx` (new)

Fixed bar at the top of the app shell, only rendered when
`state.impersonating` is set:

```
⚠ Acting as <tenantName> — all changes save to their shop.   [ EXIT ]
```

- High-contrast (e.g. `bg-accent-red text-white`), `z` above content, respects
  `pt-safe`.
- EXIT button calls `exitImpersonation()`; disabled while the swap is in flight.

Render it in `App.tsx` inside the authenticated shell, above the routed content
and bottom nav, so it shows on every page during impersonation.

### AdminConsole tenant row

Add an **Impersonate** button per tenant row (not for the admin's own row).
On click: confirm dialog → `enterImpersonation(tenant.user_id, tenant.business_name)`
→ navigate to `/`. Disable for `tenant.user_id === state.user?.id`.

## Database: migration `impersonation_events`

```sql
CREATE TABLE IF NOT EXISTS impersonation_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('start','stop')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE impersonation_events ENABLE ROW LEVEL SECURITY;

-- Admins may read the audit trail; inserts come from SECURITY DEFINER / service role.
CREATE POLICY "Super admin reads impersonation events"
  ON impersonation_events FOR SELECT USING (is_super_admin(auth.uid()));

-- Stop event: logged from the CLIENT while the TENANT session is active, so it
-- cannot use is_super_admin(auth.uid()). A SECURITY DEFINER RPC records it using
-- the most recent open 'start' for this tenant.
CREATE OR REPLACE FUNCTION admin_log_impersonation_stop()
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin uuid;
BEGIN
  SELECT admin_id INTO v_admin
    FROM impersonation_events
    WHERE tenant_id = auth.uid() AND action = 'start'
    ORDER BY created_at DESC LIMIT 1;
  IF v_admin IS NULL THEN RETURN; END IF;  -- nothing to close
  INSERT INTO impersonation_events (admin_id, tenant_id, action)
    VALUES (v_admin, auth.uid(), 'stop');
END $$;
```

The **start** insert happens in the edge function via the service-role client
(bypasses RLS). No client insert policy is needed.

## Error handling

- Edge function: 401 (no/invalid JWT), 403 (not super-admin), 400 (self /
  no email), 500 (generateLink failure). All via `json({ error }, status)`.
- `impersonateTenant`: any failure removes the backup key (if the OTP step
  failed) and surfaces a toast "Could not impersonate".
- `exitImpersonation`: if `setSession` fails, keep the backup and toast "Could
  not exit — please log in again"; the admin can re-login manually.
- Missing backup on exit: treated as already-exited (no-op).

## Security considerations

- `SUPABASE_SERVICE_ROLE_KEY` lives only in the edge function environment; never
  shipped to the client.
- Super-admin status is re-verified **server-side** on every impersonation call
  (client `isSuperAdmin` is a convenience only).
- Self-impersonation blocked.
- Every start/stop is recorded in `impersonation_events`.
- The admin session backup sits in `localStorage` on the admin's own device for
  the length of the session; cleared on exit. Losing it only means the admin
  must log in again — it grants no extra authority.
- Suspended tenants: writes remain blocked by the existing `is_tenant_active`
  RLS even while impersonated (acceptable; matches tenant reality).

## Testing

- Pure/client logic is thin; most authority is in Postgres + the edge function.
- Manual verification checklist (documented in the plan):
  1. Non-admin calling the function → 403.
  2. Admin impersonates tenant → app shows tenant data; can add a sale; it
     appears under the tenant on exit.
  3. Banner visible on every page; EXIT restores admin and lands on `/admin`.
  4. `impersonation_events` has matching start + stop rows.
  5. Self-impersonation button disabled/blocked.
  6. Mid-impersonation page refresh → still tenant, banner still present, EXIT
     still works (backup persisted).

## Ops steps (run once)

1. Apply the `impersonation_events` migration in the Supabase SQL editor.
2. `supabase functions deploy admin-impersonate`.
3. Confirm the caller's row exists in `super_admins`.
   (`SUPABASE_SERVICE_ROLE_KEY` secret already set for send-notification.)

## Files

**New**
- `supabase/functions/admin-impersonate/index.ts`
- `src/db/migration_021_impersonation_events.sql`
- `src/components/ImpersonationBanner.tsx`

**Edit**
- `src/services/adminApi.ts` — `impersonateTenant`, `stopImpersonation`
- `src/lib/store.tsx` — `impersonating` state, `SET_IMPERSONATING`,
  `enterImpersonation`/`exitImpersonation`, recompute on auth change
- `src/pages/AdminConsole.tsx` — Impersonate button per row
- `src/App.tsx` — render `ImpersonationBanner` in the authenticated shell

## What does NOT change

- Existing tenant list / suspend / delete flow.
- RLS for tenant data (impersonation uses a genuine tenant session, so ordinary
  owner policies apply).
- FIFO, capital, pack-unit logic — untouched.
