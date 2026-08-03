# Staff Accounts & RBAC — Design Spec

**Date:** 2026-08-03
**Status:** Approved (design), pending implementation plan

## 1. Summary

Today auth is strictly one-`auth.users`-row-per-tenant: `user_id` on every
domain table (`products`, `sales`, `debts`, `expenses`, `cash_movements`,
`capital_injections`, etc.) doubles as both "who is logged in" and "which
business this data belongs to." There is no concept of a second user
accessing one business's data.

This feature lets a business owner invite staff and managers as real,
separately-authenticated Supabase Auth users, each restricted by role to a
defined subset of the business's data — enforced at the database (RLS) layer,
not just hidden in the UI.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Staff login | Real Supabase Auth accounts per staff member (not shared login/PIN) |
| Roles | Owner (implicit, existing tenant), Manager, Staff |
| Enforcement | Row-Level Security on every domain table, not app-layer-only checks |
| `user_id` columns | Unchanged/unrenamed — RLS policies re-target via a `business_id_for()` lookup function instead of a data migration |
| Invite mechanism | Service-role edge function (`invite-staff`), same pattern as existing `admin-impersonate` |
| Cost price / profit margin | Row access allowed for Staff on `products` (they need stock visibility), but `cost_price` column excluded from their query at the app layer — RLS is row-scoped, not column-scoped, so this one control lives outside the DB (documented limitation, see §5) |

## 3. Data model

```sql
-- migration_023_business_members.sql
create table business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references auth.users(id), -- owner's user_id = tenant id
  member_user_id uuid references auth.users(id),        -- null until invite accepted
  invited_email text not null,
  role text not null check (role in ('manager','staff')),
  status text not null default 'invited' check (status in ('invited','active','removed')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique (business_id, invited_email)
);
-- RLS: readable/writable only by the business_id owner (staff/manager management is owner-only)

create function business_id_for(uid uuid) returns uuid stable language sql as $$
  select coalesce(
    (select id from auth.users where id = uid and exists(select 1 from business_profiles where business_profiles.user_id = uid)),
    (select business_id from business_members where member_user_id = uid and status = 'active')
  )
$$;
```

Every existing tenant-scoped RLS policy changes from `auth.uid() = user_id` to
`business_id_for(auth.uid()) = user_id`. For the owner this resolves
identically to today. For an active staff/manager it resolves to their
employer's tenant id. **No `user_id` column is renamed or backfilled** — purely
additive, so existing single-user tenants see no behavior change.

`capital_injections`, `repayment_installments`, and `cash_movements` get an
additional policy clause restricting access to the owner only:
`AND business_id_for(auth.uid()) = auth.uid()`.

## 4. Invite flow

1. Owner: Settings → "Staff" → "Invite" → email + role (Manager/Staff).
2. New edge function `invite-staff` (service role key, same trust tier as
   `admin-impersonate`): inserts `business_members` row (`status='invited'`),
   calls `supabase.auth.admin.inviteUserByEmail()`.
3. Invitee receives Supabase's invite email, sets a password, logs in. On
   first login the app matches `invited_email` to the logged-in user's email
   and flips the row to `status='active', member_user_id=<uid>,
   joined_at=now()`.
4. Owner revokes access anytime by setting `status='removed'` — RLS locks
   the member out immediately, no session/token invalidation needed since
   every subsequent query re-evaluates `business_id_for()`.

## 5. Permission matrix

| Area | Owner | Manager | Staff |
|---|---|---|---|
| Record sales / credit sales | ✅ | ✅ | ✅ |
| Products & stock (add/edit, view qty) | ✅ | ✅ | ✅ |
| Customers & debts (view, record payment) | ✅ | ✅ | ✅ |
| Voice agent (sales/stock only) | ✅ | ✅ | ✅ |
| Expenses | ✅ | ✅ | ❌ |
| Reports (profit, trends) | ✅ | ✅ | ❌ |
| Cash flow / cash balance | ✅ | ❌ | ❌ |
| Capital injections / loans | ✅ | ❌ | ❌ |
| Business settings (edit) | ✅ | view-only | ❌ |
| Invite/remove staff | ✅ | ❌ | ❌ |
| Product cost price / profit margin | ✅ | ✅ | ❌ (app-layer hidden, see §2) |

**Known limitation**: Postgres RLS is row-level, not column-level. Fully
restricted tables (cash, capital, reports-supporting queries) are blocked
outright for Staff/Manager at the database layer — a client cannot bypass
this by inspecting network traffic. Hiding `cost_price` on `products` (a table
Staff needs row access to) is enforced only at the app/query layer (the
staff-role fetch excludes that column). A staff session with a modified client
could theoretically still request it directly from Supabase's REST layer
unless a dedicated column-safe view is added later — accepted tradeoff for
v1, flagged here rather than silently glossed over.

## 6. Impacted app code

| File | Change |
|---|---|
| `supabase/functions/invite-staff/` (new) | Service-role invite flow, mirrors `admin-impersonate` |
| `src/lib/store.tsx` | Resolves `role`/`businessId` via `business_id_for` on auth; exposes `useStore().role` |
| `src/hooks/usePermission.ts` (new) | `canView('cashFlow')` etc. — single source of truth for UI gating, mirrors the matrix above |
| `src/App.tsx`, `BottomNav.tsx`, `MainApp` | Route/tab gating for Reports/Cash/Capital per role, same pattern as existing `isSuperAdmin`/`suspended` guards |
| `src/pages/Settings.tsx` | New owner-only "Staff" section: list/invite/change-role/revoke |
| `src/services/supabaseApi.ts` | `getProducts()` excludes `cost_price` for Staff-role callers |
| `supabase/functions/serwaa-agent/index.ts` | Tool schema filtered by caller's role (e.g. no `get_capital_summary` tool for Staff/Manager) |
| `src/db/migration_023_business_members.sql` + updated RLS on `products/sales/debts/expenses/customers/cash_movements/capital_injections/repayment_installments/business_profiles` | Core schema change from §3 |

## 7. Testing

- New `.test.ts` for `usePermission` matrix logic and `business_id_for`
  resolution (mocked), following the existing co-located test convention.
- SQL-level RLS verification is a **manual checklist** run in the Supabase SQL
  editor (impersonate each role, confirm expected SELECT/INSERT/UPDATE/DELETE
  results per table) — Postgres RLS isn't practically unit-tested in Vitest,
  called out explicitly rather than silently skipped.
- Manual end-to-end: invite a real Manager and Staff account, confirm each
  sees exactly the nav/tabs/data the matrix specifies, and confirm a Staff
  session calling `capital_injections` directly via dev tools gets an
  empty/denied result from RLS — not merely a hidden UI element.
