# Cash Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `cash_movements` ledger the single source of truth for two balances — Cash in Hand and Cash in Bank — with every money event (sale, debtor payment, expense, loan repayment, debt repayment, stock purchase, bank transfer, adjustment) posting a signed row.

**Architecture:** A new `cash_movements` table is summed into balances by a pure helper. Sales (by payment method), expenses, and payments auto-post movements at their existing trigger sites; deletes cascade by `ref`. A new `cashApi` service owns all ledger I/O. The dashboard switches from the old `sales − expenses` formula to the ledger only after auto-posting exists, so balances stay live. A backfill keeps launch figures correct.

**Tech Stack:** React 18 + TypeScript, Vite, Supabase (Postgres + RLS), Vitest, framer-motion, Tailwind, react-router.

## Global Constraints

- Money is Ghana Cedis; format only via `formatCurrency` from `src/lib/data.ts`.
- Every Supabase query is multi-tenant: filter `.eq('user_id', uid)` using `uidOrThrow()` (capitalApi/cashApi/batchApi) or `getCurrentUserId()` (supabaseApi/store).
- Do not add new `@typescript-eslint/no-explicit-any` violations. Use explicit row types on `select` results. Pre-existing `any` in `fetchInjectionStockSummary` is the only allowed exception (do not copy it).
- `account ∈ {'cash','bank'}`, `direction ∈ {'in','out'}`, `amount ≥ 0`. Categories: `sale, debtor_payment, expense, loan_repayment, debt_repayment, stock_purchase, bank_deposit, bank_withdrawal, adjustment`.
- Sale→account mapping: cash→cash; momo/bank→bank; credit→deposit posts to cash (remainder is a receivable, no row).
- Backfill posts ONLY already-counted events (sales by method, expenses); loan repayments and stock purchases count from launch forward (decision #4).
- TDD for pure helpers in `src/lib/`. API/UI layers gate on `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint <files>` (zero NEW problems vs baseline), `npm run build`, plus the stated manual check.
- `migration_019` must be applied to Supabase before Task 6 (the dashboard switch) is exercised; until then ledger reads are empty.
- Never break a working part between phases: the dashboard stays on the old formula until auto-posting (Task 5) is in place.

---

## PHASE 1 — Ledger foundation

### Task 1: migration_019 — table, RLS, realtime, backfill

**Files:**
- Create: `src/db/migration_019_cash_movements.sql`

**Interfaces:**
- Produces: table `cash_movements` with columns per Global Constraints; backfill rows for historical sales (by method) and expenses.

- [ ] **Step 1: Write the migration**

Create `src/db/migration_019_cash_movements.sql`:
```sql
-- migration_019: cash ledger — single source of truth for Cash in Hand + Bank.
-- Every money event is a signed row; balances are sums. See spec
-- docs/superpowers/specs/2026-06-20-cash-ledger-design.md.

CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account TEXT NOT NULL CHECK (account IN ('cash','bank')),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'sale','debtor_payment','expense','loan_repayment','debt_repayment',
    'stock_purchase','bank_deposit','bank_withdrawal','adjustment')),
  ref_table TEXT,
  ref_id TEXT,
  transfer_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own cash_movements"   ON cash_movements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own cash_movements" ON cash_movements FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own cash_movements" ON cash_movements FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own cash_movements" ON cash_movements FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cash_movements_user ON cash_movements(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_ref  ON cash_movements(ref_table, ref_id);
ALTER PUBLICATION supabase_realtime ADD TABLE cash_movements;

-- ── Backfill (idempotent) — only events already reflected in today's cash ──────
-- Sales: one IN row per sale group, account by payment method. Credit sales post
-- the collected amount (amount_paid on the linked tab) to cash.
INSERT INTO cash_movements (user_id, account, direction, amount, category, ref_table, ref_id, created_at)
SELECT g.user_id,
       CASE WHEN g.payment_method IN ('momo','bank') THEN 'bank' ELSE 'cash' END,
       'in', g.cash_amount, 'sale', 'sales', g.group_key, g.created_at
FROM (
  SELECT s.user_id,
         COALESCE(s.sale_group_id::text, s.id::text) AS group_key,
         MIN(s.payment_method) AS payment_method,
         MIN(s.created_at) AS created_at,
         CASE
           WHEN MIN(s.payment_method) = 'credit'
             THEN COALESCE(MAX(d.amount_paid), 0)
           ELSE SUM(s.total)
         END AS cash_amount
  FROM sales s
  LEFT JOIN debts d ON d.sale_group_id = s.sale_group_id AND d.user_id = s.user_id
  GROUP BY s.user_id, COALESCE(s.sale_group_id::text, s.id::text)
) g
WHERE g.cash_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM cash_movements m
    WHERE m.ref_table = 'sales' AND m.ref_id = g.group_key AND m.user_id = g.user_id
  );

-- Expenses: one OUT row per expense, from cash.
INSERT INTO cash_movements (user_id, account, direction, amount, category, ref_table, ref_id, created_at)
SELECT e.user_id, 'cash', 'out', e.amount, 'expense', 'expenses', e.id::text, e.created_at
FROM expenses e
WHERE NOT EXISTS (
  SELECT 1 FROM cash_movements m
  WHERE m.ref_table = 'expenses' AND m.ref_id = e.id::text AND m.user_id = e.user_id
);
```

- [ ] **Step 2: Sanity-check the SQL mentally**

Confirm: backfilled cash = (cash sales + credit collected) − cash expenses; bank = momo+bank sales. Total (cash+bank) equals the old `sales − unpaidCredit` inflow minus expenses. No syntax placeholders. (Cannot run against prod here; it is applied by the owner at rollout.)

- [ ] **Step 3: Commit**

```bash
git add src/db/migration_019_cash_movements.sql
git commit -m "feat: cash_movements ledger table + RLS + backfill (migration_019)"
```

---

### Task 2: Pure balance helper `computeBalances`

**Files:**
- Create: `src/lib/cashBalances.ts`
- Test: `src/lib/cashBalances.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CashAccount = 'cash' | 'bank'
  export interface CashBalances { cash: number; bank: number }
  export function computeBalances(rows: { account: CashAccount; direction: 'in' | 'out'; amount: number }[]): CashBalances
  ```
- Consumed by: Task 4 (`cashApi.fetchBalances`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cashBalances.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeBalances } from './cashBalances'

describe('computeBalances', () => {
  it('returns 0/0 for no rows', () => {
    expect(computeBalances([])).toEqual({ cash: 0, bank: 0 })
  })
  it('nets cash in minus cash out', () => {
    const out = computeBalances([
      { account: 'cash', direction: 'in', amount: 100 },
      { account: 'cash', direction: 'out', amount: 30 },
    ])
    expect(out).toEqual({ cash: 70, bank: 0 })
  })
  it('nets bank separately', () => {
    const out = computeBalances([
      { account: 'bank', direction: 'in', amount: 200 },
      { account: 'bank', direction: 'out', amount: 50 },
      { account: 'cash', direction: 'in', amount: 10 },
    ])
    expect(out).toEqual({ cash: 10, bank: 150 })
  })
  it('a transfer (cash out + bank in) leaves total unchanged', () => {
    const out = computeBalances([
      { account: 'cash', direction: 'in', amount: 100 },
      { account: 'cash', direction: 'out', amount: 40 }, // deposit leg
      { account: 'bank', direction: 'in', amount: 40 },  // deposit leg
    ])
    expect(out.cash + out.bank).toBe(100)
    expect(out).toEqual({ cash: 60, bank: 40 })
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/cashBalances.test.ts`
Expected: FAIL — cannot resolve `./cashBalances`.

- [ ] **Step 3: Implement**

Create `src/lib/cashBalances.ts`:
```ts
// Pure: fold cash_movements rows into the two account balances. Supabase-free so
// it is unit-testable.
export type CashAccount = 'cash' | 'bank'
export interface CashBalances { cash: number; bank: number }

export function computeBalances(
  rows: { account: CashAccount; direction: 'in' | 'out'; amount: number }[],
): CashBalances {
  const bal: CashBalances = { cash: 0, bank: 0 }
  for (const r of rows) {
    const delta = r.direction === 'in' ? r.amount : -r.amount
    if (r.account === 'cash') bal.cash += delta
    else bal.bank += delta
  }
  bal.cash = Math.round(bal.cash * 100) / 100
  bal.bank = Math.round(bal.bank * 100) / 100
  return bal
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/cashBalances.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cashBalances.ts src/lib/cashBalances.test.ts
git commit -m "feat: pure cash balance helper"
```

---

### Task 3: Pure sale→movement helper `saleMovement`

**Files:**
- Create: `src/lib/cashPosting.ts`
- Test: `src/lib/cashPosting.test.ts`

**Interfaces:**
- Consumes: `CashAccount` from `src/lib/cashBalances.ts`.
- Produces:
  ```ts
  export function saleMovement(method: string, total: number, deposit: number): { account: CashAccount; amount: number } | null
  ```
- Consumed by: Task 6 (AddSaleSheet) — maps a sale to its cash inflow.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cashPosting.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { saleMovement } from './cashPosting'

describe('saleMovement', () => {
  it('cash sale → full total to cash', () => {
    expect(saleMovement('cash', 50, 0)).toEqual({ account: 'cash', amount: 50 })
  })
  it('momo sale → full total to bank', () => {
    expect(saleMovement('momo', 50, 0)).toEqual({ account: 'bank', amount: 50 })
  })
  it('bank sale → full total to bank', () => {
    expect(saleMovement('bank', 80, 0)).toEqual({ account: 'bank', amount: 80 })
  })
  it('credit sale → only the deposit to cash', () => {
    expect(saleMovement('credit', 100, 20)).toEqual({ account: 'cash', amount: 20 })
  })
  it('credit sale with no deposit → no movement', () => {
    expect(saleMovement('credit', 100, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/cashPosting.test.ts`
Expected: FAIL — cannot resolve `./cashPosting`.

- [ ] **Step 3: Implement**

Create `src/lib/cashPosting.ts`:
```ts
import type { CashAccount } from './cashBalances'

// Map a sale to the cash inflow it produces. cash→cash; momo/bank→bank;
// credit→only the deposit, to cash (the rest is a receivable). Returns null when
// no cash actually arrives (credit with no deposit).
export function saleMovement(
  method: string, total: number, deposit: number,
): { account: CashAccount; amount: number } | null {
  if (method === 'credit') return deposit > 0 ? { account: 'cash', amount: deposit } : null
  if (method === 'momo' || method === 'bank') return { account: 'bank', amount: total }
  return { account: 'cash', amount: total }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/cashPosting.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cashPosting.ts src/lib/cashPosting.test.ts
git commit -m "feat: pure sale->cash-movement mapping helper"
```

---

### Task 4: `cashApi` service

**Files:**
- Create: `src/services/cashApi.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`; `computeBalances`, `CashAccount`, `CashBalances` from `@/lib/cashBalances`.
- Produces:
  ```ts
  export type CashCategory = 'sale'|'debtor_payment'|'expense'|'loan_repayment'|'debt_repayment'|'stock_purchase'|'bank_deposit'|'bank_withdrawal'|'adjustment'
  export interface CashMovement { id: string; user_id: string; account: CashAccount; direction: 'in'|'out'; amount: number; category: CashCategory; ref_table: string|null; ref_id: string|null; transfer_id: string|null; note: string|null; created_at: string }
  export interface NewMovement { account: CashAccount; direction: 'in'|'out'; amount: number; category: CashCategory; ref_table?: string|null; ref_id?: string|null; transfer_id?: string|null; note?: string|null; created_at?: string }
  export async function fetchMovements(limit?: number): Promise<CashMovement[]>
  export async function fetchBalances(): Promise<CashBalances>
  export async function postMovement(m: NewMovement): Promise<void>
  export async function deleteMovementsByRef(refTable: string, refId: string): Promise<void>
  export async function postTransfer(from: CashAccount, to: CashAccount, amount: number, note?: string|null): Promise<void>
  ```
- Consumed by: Tasks 5, 6, 8, 9, 10, 11 and `getDashboardSummary`.

- [ ] **Step 1: Implement the service**

Create `src/services/cashApi.ts`:
```ts
import { supabase } from '@/lib/supabase'
import { computeBalances, type CashAccount, type CashBalances } from '@/lib/cashBalances'

async function uidOrThrow(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const uid = data.user?.id
  if (!uid) throw new Error('Not authenticated')
  return uid
}

export type CashCategory =
  | 'sale' | 'debtor_payment' | 'expense' | 'loan_repayment' | 'debt_repayment'
  | 'stock_purchase' | 'bank_deposit' | 'bank_withdrawal' | 'adjustment'

export interface CashMovement {
  id: string; user_id: string; account: CashAccount; direction: 'in' | 'out'
  amount: number; category: CashCategory; ref_table: string | null
  ref_id: string | null; transfer_id: string | null; note: string | null; created_at: string
}

export interface NewMovement {
  account: CashAccount; direction: 'in' | 'out'; amount: number; category: CashCategory
  ref_table?: string | null; ref_id?: string | null; transfer_id?: string | null
  note?: string | null; created_at?: string
}

export async function fetchMovements(limit = 200): Promise<CashMovement[]> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('cash_movements')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as CashMovement[]) || []
}

export async function fetchBalances(): Promise<CashBalances> {
  const uid = await uidOrThrow()
  const { data, error } = await supabase
    .from('cash_movements')
    .select('account, direction, amount')
    .eq('user_id', uid)
  if (error) throw error
  return computeBalances((data as { account: CashAccount; direction: 'in' | 'out'; amount: number }[]) || [])
}

export async function postMovement(m: NewMovement): Promise<void> {
  const uid = await uidOrThrow()
  if (!m.amount || m.amount <= 0) return // never post a zero/negative row
  const { error } = await supabase.from('cash_movements').insert({
    user_id: uid,
    account: m.account,
    direction: m.direction,
    amount: Math.round(m.amount * 100) / 100,
    category: m.category,
    ref_table: m.ref_table ?? null,
    ref_id: m.ref_id ?? null,
    transfer_id: m.transfer_id ?? null,
    note: m.note ?? null,
    created_at: m.created_at ?? new Date().toISOString(),
  })
  if (error) throw error
}

export async function deleteMovementsByRef(refTable: string, refId: string): Promise<void> {
  const uid = await uidOrThrow()
  const { error } = await supabase
    .from('cash_movements')
    .delete()
    .eq('user_id', uid)
    .eq('ref_table', refTable)
    .eq('ref_id', refId)
  if (error) throw error
}

// A transfer is two legs (out of `from`, into `to`) sharing one transfer_id.
export async function postTransfer(from: CashAccount, to: CashAccount, amount: number, note?: string | null): Promise<void> {
  const uid = await uidOrThrow()
  if (!amount || amount <= 0) return
  const transfer_id = crypto.randomUUID()
  const amt = Math.round(amount * 100) / 100
  const category = to === 'bank' ? 'bank_deposit' : 'bank_withdrawal'
  const { error } = await supabase.from('cash_movements').insert([
    { user_id: uid, account: from, direction: 'out', amount: amt, category, transfer_id, note: note ?? null },
    { user_id: uid, account: to,   direction: 'in',  amount: amt, category, transfer_id, note: note ?? null },
  ])
  if (error) throw error
}
```

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc -p tsconfig.app.json --noEmit` → no output.
Run: `npx eslint src/services/cashApi.ts` → no problems.
Run: `npm run build` → `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/services/cashApi.ts
git commit -m "feat: cashApi service for ledger reads/writes"
```

---

## PHASE 2 — Auto-post core events, then switch the dashboard

### Task 5: Auto-post sales + expenses, with delete-sync

**Files:**
- Modify: `src/lib/store.tsx` (`addExpense`, `removeExpense`)
- Modify: `src/services/supabaseApi.ts` (`deleteSaleGroup` — add movement cascade)
- Modify: `src/components/AddSaleSheet.tsx` (post the sale movement on confirm)

**Interfaces:**
- Consumes: `cashApi.postMovement`, `cashApi.deleteMovementsByRef`; `saleMovement` from `@/lib/cashPosting`.
- Produces: every new sale/expense writes a ledger row; deleting them removes it. (Account picker UIs come in Phase 3; here expenses default to `cash`.)

- [ ] **Step 1: Post the sale movement in AddSaleSheet**

In `src/components/AddSaleSheet.tsx`, add imports near the top:
```ts
import { postMovement } from '@/services/cashApi'
import { saleMovement } from '@/lib/cashPosting'
```
In `handleConfirm`, immediately AFTER the credit-tab `addDebt` block you added earlier (and still inside the `try`), insert:
```ts
      // Ledger: post the cash actually received for this sale.
      const deposit = paymentMethod === 'credit'
        ? Math.min(Math.max(0, parseFloat(depositInput) || 0), total)
        : 0
      const mv = saleMovement(paymentMethod, total, deposit)
      if (mv) {
        await postMovement({
          account: mv.account, direction: 'in', amount: mv.amount, category: 'sale',
          ref_table: 'sales', ref_id: groupId, note: customerName || null, created_at: createdAt,
        })
      }
```

- [ ] **Step 2: Cascade movement deletion when a sale is deleted**

In `src/services/supabaseApi.ts`, in `deleteSaleGroup`, find the credit-tab cleanup block added earlier (`if (groupIds.length) { await supabase.from('debts').delete()... }`) and append, right after it:
```ts
  if (groupIds.length) {
    const { deleteMovementsByRef } = await import('@/services/cashApi')
    for (const g of groupIds) await deleteMovementsByRef('sales', g)
  }
```

- [ ] **Step 3: Post/delete expense movements in the store**

In `src/lib/store.tsx`, add an import at the top alongside the other service imports:
```ts
import { postMovement as postCashMovement, deleteMovementsByRef as deleteCashByRef } from '@/services/cashApi'
```
Replace `addExpense` with:
```ts
  const addExpense = useCallback(async (expense: Omit<Expense, 'user_id'>) => {
    try {
      const inserted = await insertExpense(expense)
      dispatch({ type: 'ADD_EXPENSE', expense: inserted })
      // Ledger: expense leaves cash by default (account picker added in Phase 3).
      try {
        await postCashMovement({
          account: 'cash', direction: 'out', amount: inserted.amount, category: 'expense',
          ref_table: 'expenses', ref_id: inserted.id, note: inserted.name, created_at: inserted.created_at,
        })
      } catch { /* ledger post best-effort; balance reconciles on next refresh */ }
    } catch {
      const localExpense: Expense = { ...expense, user_id: 'local' } as Expense
      dispatch({ type: 'ADD_EXPENSE', expense: localExpense })
    }
  }, [state])
```
Replace `removeExpense` with:
```ts
  const removeExpense = useCallback(async (id: string) => {
    try { await deleteExpenseDb(id) } catch { /* */ }
    try { await deleteCashByRef('expenses', id) } catch { /* */ }
    dispatch({ type: 'DELETE_EXPENSE', id })
  }, [])
```

- [ ] **Step 4: Typecheck + lint + build**

Run: `npx tsc -p tsconfig.app.json --noEmit` → no output.
Run: `npx eslint src/lib/store.tsx src/services/supabaseApi.ts src/components/AddSaleSheet.tsx` → no NEW problems vs baseline.
Run: `npm run build` → `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.tsx src/services/supabaseApi.ts src/components/AddSaleSheet.tsx
git commit -m "feat: auto-post cash movements for sales and expenses"
```

---

### Task 6: Switch the dashboard to the ledger (Cash in Hand + Cash in Bank)

**Files:**
- Modify: `src/services/supabaseApi.ts` (`getDashboardSummary`)
- Modify: `src/lib/store.tsx` (state `bankBalance`, action `SET_BANK_BALANCE`, balance refresh sites)
- Modify: `src/pages/Dashboard.tsx` (hero shows both balances)

**Interfaces:**
- Consumes: `cashApi.fetchBalances`.
- Produces: `getDashboardSummary` returns `cashInHand` (= ledger cash) and `cashInBank`; store exposes `state.bankBalance`.

- [ ] **Step 1: Compute balances from the ledger in the summary**

In `src/services/supabaseApi.ts`, top of file, add:
```ts
import { fetchBalances } from '@/services/cashApi'
```
In `getDashboardSummary`'s return type, add `cashInBank: number` (next to `cashInHand`). In the early `if (!uid)` return object, add `cashInBank: 0`. Replace the line
```ts
  const cashInHand = totalSales - totalExpenses - creditSalesOutstanding
```
with:
```ts
  // Cash now comes from the ledger (source of truth), not a derived formula.
  let cashInHand = totalSales - totalExpenses - creditSalesOutstanding // fallback
  let cashInBank = 0
  try {
    const bal = await fetchBalances()
    cashInHand = bal.cash
    cashInBank = bal.bank
  } catch { /* ledger unavailable (pre-migration / offline) — keep fallback */ }
```
Add `cashInBank` to the final `return { ... }`.

- [ ] **Step 2: Add bankBalance to the store**

In `src/lib/store.tsx`:
- In `AppState`, add `bankBalance: number`.
- In the `Action` union, add `| { type: 'SET_BANK_BALANCE'; value: number }`.
- In `initialState`, add `bankBalance: 0,`.
- In `appReducer`, add `case 'SET_BANK_BALANCE': return { ...state, bankBalance: action.value }`.
- In `StoreContextType`/provider nothing else needed (bankBalance read via `state`).

In `refreshData`'s `LOAD_ALL_DATA` dispatch, the summary already has `cashInBank`; right after that dispatch add:
```ts
      dispatch({ type: 'SET_BANK_BALANCE', value: summary.cashInBank || 0 })
```
At each of the three post-mutation balance refresh sites that call `getDashboardSummary` (the `dispatch({ type: 'SET_BALANCE', value: summary.cashInHand })` lines in `addSale`, `addSaleBatch`, `deleteSale`), add immediately after each:
```ts
      dispatch({ type: 'SET_BANK_BALANCE', value: summary.cashInBank })
```
Update the two fallback summary literals (the `results[4]... : { ... }` in `refreshData`, and any other) to include `cashInBank: 0`.

- [ ] **Step 3: Show both balances on the dashboard hero**

In `src/pages/Dashboard.tsx`, replace the hero inner block:
```tsx
        <div className="text-center">
          <p className="text-micro text-muted-text mb-2">{t('total_cash')}</p>
          <Odometer value={state.balance} />
        </div>
```
with:
```tsx
        <div className="text-center">
          <p className="text-micro text-muted-text mb-2">{t('total_cash')}</p>
          <Odometer value={state.balance} />
          <button
            onClick={() => navigate('/cash')}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-text active:opacity-60"
          >
            <span className="font-display text-ink">{formatCurrency(state.bankBalance)}</span> in bank →
          </button>
        </div>
```
Ensure `navigate` exists in `Dashboard.tsx` (it uses react-router). If not present, add at the top of the component: `const navigate = useNavigate()` and import `useNavigate` from `'react-router'`. `formatCurrency` is already imported.

> The `/cash` route is created in Task 11. Until then the button is harmless (navigates to the catch-all MainApp). Acceptable between phases.

- [ ] **Step 4: Typecheck + lint + build + manual**

Run: `npx tsc -p tsconfig.app.json --noEmit` → no output.
Run: `npx eslint src/services/supabaseApi.ts src/lib/store.tsx src/pages/Dashboard.tsx` → no NEW problems.
Run: `npm run build` → `✓ built`.
Manual (migration_019 applied): dashboard shows Cash in Hand from the ledger and a "… in bank" figure; record a cash sale → hand rises; a momo sale → bank rises; an expense → hand drops.

- [ ] **Step 5: Commit**

```bash
git add src/services/supabaseApi.ts src/lib/store.tsx src/pages/Dashboard.tsx
git commit -m "feat: dashboard cash from ledger + show bank balance"
```

---

## PHASE 3 — Outflow account pickers + posting at existing triggers

### Task 7: Account picker on expenses

**Files:**
- Modify: `src/pages/Expenses.tsx` (add cash/bank toggle, pass account)
- Modify: `src/lib/store.tsx` (`addExpense` accepts an account)

**Interfaces:**
- Consumes: `addExpense` (extended signature).
- Produces: `addExpense(expense, account: CashAccount = 'cash')`.

- [ ] **Step 1: Extend `addExpense` to take an account**

In `src/lib/store.tsx`, change the `addExpense` signature in `StoreContextType` to:
```ts
  addExpense: (expense: Omit<Expense, 'user_id'>, account?: import('@/lib/cashBalances').CashAccount) => Promise<void>
```
and the implementation header + ledger post:
```ts
  const addExpense = useCallback(async (expense: Omit<Expense, 'user_id'>, account: import('@/lib/cashBalances').CashAccount = 'cash') => {
    try {
      const inserted = await insertExpense(expense)
      dispatch({ type: 'ADD_EXPENSE', expense: inserted })
      try {
        await postCashMovement({
          account, direction: 'out', amount: inserted.amount, category: 'expense',
          ref_table: 'expenses', ref_id: inserted.id, note: inserted.name, created_at: inserted.created_at,
        })
      } catch { /* best-effort */ }
    } catch {
      const localExpense: Expense = { ...expense, user_id: 'local' } as Expense
      dispatch({ type: 'ADD_EXPENSE', expense: localExpense })
    }
  }, [state])
```

- [ ] **Step 2: Add the toggle in the expense form**

In `src/pages/Expenses.tsx`, add state near the other form state:
```ts
  const [payFrom, setPayFrom] = useState<'cash' | 'bank'>('cash')
```
In the add-expense form (before the save button), add:
```tsx
                <div>
                  <label className="text-micro text-muted-text mb-2 block">PAID FROM</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['cash','bank'] as const).map((a) => (
                      <button key={a} type="button" onClick={() => setPayFrom(a)}
                        className={`btn-tactile py-3 font-display text-xs uppercase tracking-wide rounded-sm border-2 ${payFrom === a ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                        {a === 'cash' ? 'Cash in hand' : 'Cash in bank'}
                      </button>
                    ))}
                  </div>
                </div>
```
Change the `addExpense({...})` call to pass the account: `await addExpense({ ...sameObject... }, payFrom)`. After a successful save, reset `setPayFrom('cash')`.

- [ ] **Step 3: Typecheck + lint + build + manual**

`npx tsc -p tsconfig.app.json --noEmit` → clean. `npx eslint src/pages/Expenses.tsx src/lib/store.tsx` → no new problems. `npm run build` → ✓.
Manual: add an expense paid from bank → bank balance drops, cash unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Expenses.tsx src/lib/store.tsx
git commit -m "feat: choose cash or bank when recording an expense"
```

---

### Task 8: Loan repayment posts an outflow with account choice

**Files:**
- Modify: `src/services/capitalApi.ts` (`recordInstallmentPayment` gains an account, posts movement)
- Modify: `src/pages/InjectionDetail.tsx` (account toggle by the Pay input)

**Interfaces:**
- Consumes: `cashApi.postMovement`.
- Produces: `recordInstallmentPayment(injectionId, amount, account: CashAccount = 'cash')`.

- [ ] **Step 1: Post the outflow in `recordInstallmentPayment`**

In `src/services/capitalApi.ts`, add near the top imports:
```ts
import { postMovement } from '@/services/cashApi'
import type { CashAccount } from '@/lib/cashBalances'
```
Change the signature and append a ledger post at the end of the function (after the injection `amount_repaid` update):
```ts
export async function recordInstallmentPayment(injectionId: string, amount: number, account: CashAccount = 'cash'): Promise<void> {
```
…and just before the function returns, add:
```ts
  const applied = amount // amount actually applied; clamped earlier to remaining
  await postMovement({
    account, direction: 'out', amount: applied, category: 'loan_repayment',
    ref_table: 'capital_injections', ref_id: injectionId, note: 'Loan repayment',
  })
```
> Note: `recordInstallmentPayment` already distributes `amount` across installments; post the same `amount` it was called with (the UI passes only what the user is paying).

- [ ] **Step 2: Account toggle in InjectionDetail**

In `src/pages/InjectionDetail.tsx`, add state:
```ts
  const [payFrom, setPayFrom] = useState<'cash' | 'bank'>('cash')
```
Change the `pay` handler call to `await recordInstallmentPayment(inj.id, amt, payFrom)`. In the schedule card's pay row (the `flex gap-2 mt-3` block), add a small toggle above the input:
```tsx
              <div className="grid grid-cols-2 gap-2 mb-2">
                {(['cash','bank'] as const).map((a) => (
                  <button key={a} type="button" onClick={() => setPayFrom(a)}
                    className={`py-2 text-xs uppercase tracking-wide rounded-sm border-2 ${payFrom === a ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-ink'}`}>
                    {a === 'cash' ? 'From cash' : 'From bank'}
                  </button>
                ))}
              </div>
```

- [ ] **Step 3: Typecheck + lint + build + manual**

Clean tsc/eslint/build. Manual: pay a loan installment from bank → bank drops; from cash → hand drops; recovery/schedule behave as before.

- [ ] **Step 4: Commit**

```bash
git add src/services/capitalApi.ts src/pages/InjectionDetail.tsx
git commit -m "feat: loan repayments post a cash/bank outflow"
```

---

### Task 9: Stock purchase posts an outflow (or supplier credit)

**Files:**
- Modify: `src/services/batchApi.ts` (`receiveStock` gains `account` + `unpaid`, posts movement)
- Modify: `src/pages/Inventory.tsx` (restock UI: account toggle + "unpaid")

**Interfaces:**
- Consumes: `cashApi.postMovement`.
- Produces: `receiveStock({ ..., account?: CashAccount, unpaid?: boolean })` — posts a `stock_purchase` OUT for `total_cost` unless `unpaid`.

- [ ] **Step 1: Post the outflow in `receiveStock`**

In `src/services/batchApi.ts`, add imports:
```ts
import { postMovement } from '@/services/cashApi'
import type { CashAccount } from '@/lib/cashBalances'
```
Extend the params type with `account?: CashAccount` and `unpaid?: boolean`. After the batch insert succeeds (before `return data as StockBatch`):
```ts
  const batch = data as StockBatch
  if (!params.unpaid) {
    try {
      await postMovement({
        account: params.account ?? 'cash', direction: 'out', amount: batch.total_cost,
        category: 'stock_purchase', ref_table: 'stock_batches', ref_id: batch.id, note: 'Stock purchase',
      })
    } catch { /* best-effort; balance reconciles on refresh */ }
  }
  return batch
```
(Replace the existing `return data as StockBatch` accordingly.)

> Existing callers (`store.addProduct`, `BarcodeScanner`) pass no `account`/`unpaid`, so they default to a cash outflow — correct and non-breaking.

- [ ] **Step 2: Restock UI account + unpaid**

In `src/pages/Inventory.tsx`, add state near the restock state:
```ts
  const [restockPayFrom, setRestockPayFrom] = useState<'cash' | 'bank'>('cash')
  const [restockUnpaid, setRestockUnpaid] = useState(false)
```
In the restock sheet (near the qty/cost inputs), add:
```tsx
              <div className="grid grid-cols-2 gap-2">
                {(['cash','bank'] as const).map((a) => (
                  <button key={a} type="button" onClick={() => { setRestockPayFrom(a); setRestockUnpaid(false) }}
                    className={`py-2 text-xs uppercase tracking-wide rounded-sm border-2 ${!restockUnpaid && restockPayFrom === a ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                    {a === 'cash' ? 'Paid cash' : 'Paid bank'}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setRestockUnpaid((v) => !v)}
                className={`mt-2 w-full py-2 text-xs uppercase tracking-wide rounded-sm border-2 ${restockUnpaid ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                {restockUnpaid ? '✓ Unpaid (supplier credit)' : 'Unpaid (supplier credit)'}
              </button>
```
Change the restock `receiveStock({...})` call to include `account: restockPayFrom, unpaid: restockUnpaid`.

- [ ] **Step 3: Typecheck + lint + build + manual**

Clean tsc/eslint/build. Manual: restock paid from cash → hand drops by cost; mark "unpaid" → no balance change; stock still increases in all cases.

- [ ] **Step 4: Commit**

```bash
git add src/services/batchApi.ts src/pages/Inventory.tsx
git commit -m "feat: stock purchases post a cash/bank outflow (or supplier credit)"
```

---

### Task 10: Debtor & owing payments post movements with account choice

**Files:**
- Modify: `src/pages/Debts.tsx` (account toggle on the record-payment sheet; post on pay; delete-by-ref on payment delete)

**Interfaces:**
- Consumes: `cashApi.postMovement`, `cashApi.deleteMovementsByRef`.
- Produces: recording a payment on an `owed` debt posts a `debtor_payment` IN; on an `owing` debt posts a `debt_repayment` OUT; deleting a payment removes the matching movement.

- [ ] **Step 1: Imports + account state**

In `src/pages/Debts.tsx`, add:
```ts
import { postMovement, deleteMovementsByRef } from '@/services/cashApi'
```
Add state near the payment state: `const [payAccount, setPayAccount] = useState<'cash' | 'bank'>('cash')`.

- [ ] **Step 2: Post the movement in `recordPayment`**

In `recordPayment`, after the successful `updateDebt(...)` call, add:
```ts
      try {
        await postMovement({
          account: payAccount,
          direction: debt.type === 'owed' ? 'in' : 'out',
          amount: pay,
          category: debt.type === 'owed' ? 'debtor_payment' : 'debt_repayment',
          ref_table: 'debts', ref_id: debt.id,
          note: debt.person_name,
        })
      } catch { /* best-effort */ }
```
The existing optimistic `dispatch({ type: 'SET_BALANCE', value: state.balance + pay })` for `owed` debts can stay (it makes the hand figure feel instant); the next `getDashboardSummary` refresh reconciles from the ledger. Leave it as-is.

- [ ] **Step 3: Remove the matching movement when a payment is deleted**

In `handleDeletePayment`, after the successful `updateDebt(...)`, add:
```ts
      // Remove the most recent ledger movement for this debt that matches the
      // deleted payment amount.
      try {
        const { fetchMovements } = await import('@/services/cashApi')
        const rows = await fetchMovements(500)
        const match = rows.find((m) => m.ref_table === 'debts' && m.ref_id === debt.id && Math.abs(m.amount - p.amount) < 0.001)
        if (match) {
          const { supabase } = await import('@/lib/supabase')
          await supabase.from('cash_movements').delete().eq('id', match.id)
        }
      } catch { /* best-effort */ }
```

- [ ] **Step 4: Account toggle on the record-payment sheet**

In the Record Payment sheet (where `paymentInput` is entered), add above the amount input:
```tsx
              <div className="grid grid-cols-2 gap-2 mb-3">
                {(['cash','bank'] as const).map((a) => (
                  <button key={a} type="button" onClick={() => setPayAccount(a)}
                    className={`py-2 text-xs uppercase tracking-wide rounded-sm border-2 ${payAccount === a ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'}`}>
                    {a === 'cash' ? 'Cash' : 'Bank'}
                  </button>
                ))}
              </div>
```
Reset `setPayAccount('cash')` when opening the sheet (`openPayment`).

- [ ] **Step 5: Typecheck + lint + build + manual**

Clean tsc/eslint/build. Manual: a debtor pays into bank → bank rises; pay an "I owe them" debt from cash → hand drops; delete a payment → its movement disappears and the balance corrects on refresh.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Debts.tsx
git commit -m "feat: debtor/owing payments post cash-or-bank movements"
```

---

## PHASE 4 — Cash Flow page, transfers, adjustments

### Task 11: Cash Flow page + route + transfers + adjustment

**Files:**
- Create: `src/pages/CashFlow.tsx`
- Modify: `src/App.tsx` (add `/cash` route)

**Interfaces:**
- Consumes: `cashApi.fetchMovements`, `fetchBalances`, `postTransfer`, `postMovement`; store `refreshData`.
- Produces: a page at `/cash` showing both balances, the movement list, and actions (deposit, withdraw, adjustment).

- [ ] **Step 1: Build the page**

Create `src/pages/CashFlow.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeft, Plus } from 'lucide-react'
import { formatCurrency, formatDate } from '@/lib/data'
import { fetchMovements, fetchBalances, postTransfer, postMovement, type CashMovement } from '@/services/cashApi'
import { useStore } from '@/lib/store'

const CAT_LABEL: Record<string, string> = {
  sale: 'Sale', debtor_payment: 'Debtor payment', expense: 'Expense',
  loan_repayment: 'Loan repayment', debt_repayment: 'Debt repayment',
  stock_purchase: 'Stock purchase', bank_deposit: 'Bank deposit',
  bank_withdrawal: 'Bank withdrawal', adjustment: 'Adjustment',
}

type Action = 'deposit' | 'withdraw' | 'adjust' | null

export default function CashFlow() {
  const navigate = useNavigate()
  const { refreshData } = useStore()
  const [rows, setRows] = useState<CashMovement[]>([])
  const [bal, setBal] = useState({ cash: 0, bank: 0 })
  const [action, setAction] = useState<Action>(null)
  const [amount, setAmount] = useState('')
  const [adjAccount, setAdjAccount] = useState<'cash' | 'bank'>('cash')
  const [adjDir, setAdjDir] = useState<'in' | 'out'>('in')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [m, b] = await Promise.all([fetchMovements(200), fetchBalances()])
    setRows(m); setBal(b)
  }
  useEffect(() => { load() }, [])

  const submit = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return
    setBusy(true)
    try {
      if (action === 'deposit') await postTransfer('cash', 'bank', amt, note || null)
      else if (action === 'withdraw') await postTransfer('bank', 'cash', amt, note || null)
      else if (action === 'adjust') await postMovement({ account: adjAccount, direction: adjDir, amount: amt, category: 'adjustment', note: note || 'Adjustment' })
      setAction(null); setAmount(''); setNote('')
      await load(); await refreshData()
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen bg-light pb-24">
      <header className="bg-ink text-white px-5 pt-[calc(env(safe-area-inset-top)_+_1.5rem)] pb-5">
        <button onClick={() => navigate('/')} className="flex items-center gap-1 text-white/70 text-sm mb-3">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="font-display text-xl">Cash Flow</h1>
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3">
          <div className="min-w-0"><p className="text-xs text-white/60">Cash in hand</p><p className="font-display text-lg truncate">{formatCurrency(bal.cash)}</p></div>
          <div className="min-w-0"><p className="text-xs text-white/60">Cash in bank</p><p className="font-display text-lg truncate">{formatCurrency(bal.bank)}</p></div>
        </div>
      </header>

      <div className="px-5 py-3 flex gap-2">
        <button onClick={() => setAction('deposit')} className="btn-tactile flex-1 py-2.5 text-xs uppercase tracking-wide rounded-sm border-2 border-ink bg-light">Deposit → bank</button>
        <button onClick={() => setAction('withdraw')} className="btn-tactile flex-1 py-2.5 text-xs uppercase tracking-wide rounded-sm border-2 border-ink bg-light">Withdraw → cash</button>
        <button onClick={() => setAction('adjust')} className="btn-tactile flex-1 py-2.5 text-xs uppercase tracking-wide rounded-sm border-2 border-ink bg-light">Adjust</button>
      </div>

      <div className="px-5 space-y-2">
        {rows.length === 0 && <p className="text-sm text-muted-text py-8 text-center">No movements yet.</p>}
        {rows.map((m) => (
          <div key={m.id} className="bg-white harsh-border rounded-sm px-4 py-3 flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm text-ink truncate">{CAT_LABEL[m.category] || m.category}{m.note ? ` · ${m.note}` : ''}</p>
              <p className="text-[11px] text-muted-text">{formatDate(m.created_at)} · {m.account === 'cash' ? 'Cash' : 'Bank'}</p>
            </div>
            <span className={`font-display text-sm shrink-0 ${m.direction === 'in' ? 'text-accent-green' : 'text-accent-red'}`}>
              {m.direction === 'in' ? '+' : '−'}{formatCurrency(m.amount)}
            </span>
          </div>
        ))}
      </div>

      {action && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setAction(null)} />
          <div className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-4">
            <p className="font-display text-lg uppercase">{action === 'deposit' ? 'Deposit to bank' : action === 'withdraw' ? 'Withdraw to cash' : 'Adjustment'}</p>
            {action === 'adjust' && (
              <div className="grid grid-cols-2 gap-2">
                {(['cash','bank'] as const).map((a) => (
                  <button key={a} onClick={() => setAdjAccount(a)} className={`py-2 text-xs uppercase rounded-sm border-2 border-ink ${adjAccount === a ? 'bg-ink text-white' : 'bg-light'}`}>{a}</button>
                ))}
                {(['in','out'] as const).map((d) => (
                  <button key={d} onClick={() => setAdjDir(d)} className={`py-2 text-xs uppercase rounded-sm border-2 border-ink ${adjDir === d ? 'bg-ink text-white' : 'bg-light'}`}>{d === 'in' ? 'Add' : 'Remove'}</button>
                ))}
              </div>
            )}
            <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (GH₵)"
              className="block w-full min-w-0 max-w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body appearance-none" />
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
              className="block w-full min-w-0 max-w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body" />
            <div className="flex gap-3">
              <button onClick={() => setAction(null)} className="btn-tactile flex-1 h-12 bg-warm-gray font-display text-sm uppercase rounded-sm">Cancel</button>
              <button onClick={submit} disabled={busy} className="btn-tactile flex-1 h-12 bg-ink text-white font-display text-sm uppercase rounded-sm disabled:opacity-50">{busy ? '…' : 'Save'}</button>
            </div>
          </div>
        </>
      )}

      <button onClick={() => setAction('adjust')} aria-label="Add adjustment"
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] right-5 w-14 h-14 rounded-full bg-accent-red text-white flex items-center justify-center shadow-lg z-30">
        <Plus size={26} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add the route**

In `src/App.tsx`, add a route alongside `/capital` (same auth-guard pattern):
```tsx
          <Route
            path="/cash"
            element={state.isAuthenticated ? (
              <div className="h-full w-full overflow-y-auto bg-sand relative"><CashFlow /></div>
            ) : <Navigate to="/login" replace />}
          />
```
And import at the top of `src/App.tsx`: `import CashFlow from '@/pages/CashFlow'`.

- [ ] **Step 3: Typecheck + lint + build + manual**

Clean tsc/eslint/build. Manual: open `/cash` (via the Dashboard bank button); deposit GHC 50 → cash −50, bank +50, total unchanged; withdraw reverses; an "Add" adjustment to cash raises hand; the movement list shows every entry color-coded.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CashFlow.tsx src/App.tsx
git commit -m "feat: Cash Flow page with transfers and adjustments"
```

---

## Self-Review Notes (resolved)

- **Spec coverage:** §1 table/RLS/backfill → Task 1; §2 service → Task 4 (+ pure helpers Tasks 2–3); §3 posting rules → Tasks 5 (sale/expense), 8 (loan), 9 (stock), 10 (debtor/owing); §4 dashboard/store → Task 6; §5 UI → Tasks 6 (hero), 7/8/9/10 (account pickers), 11 (Cash Flow page + transfers + adjustments); §6 testing → Tasks 2,3 unit tests; §7 rollout → Global Constraints + Task 6 manual. O1 (payment edit/delete sync) → Task 10 step 3. O2 (momo=bank) → Task 1 backfill + Task 3 helper.
- **Type consistency:** `CashAccount`/`CashBalances` (Task 2) reused in Tasks 3,4,7,8,9; `CashMovement`/`NewMovement`/`CashCategory` (Task 4) reused in 5,6,8,9,10,11; `saleMovement` (Task 3) used in Task 5; `postMovement`/`deleteMovementsByRef`/`postTransfer`/`fetchBalances`/`fetchMovements` signatures match across producers/consumers.
- **No-break ordering:** dashboard stays on the old formula until Task 6, which runs only after auto-posting (Task 5); the `/cash` route button in Task 6 is harmless until Task 11.
- **Placeholders:** none — every code step shows full code.
```
