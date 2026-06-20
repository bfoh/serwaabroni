# Credit Sales → Capital-Linked Debts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a sale be marked CREDIT at the point of sale, auto-create the customer's tab linked to that sale, and withhold the funding loan's profit-recovery until the customer pays — proportionally, split correctly across loans.

**Architecture:** A credit sale records normally (stock leaves via FIFO, `batch_consumptions` created) but with `payment_method='credit'` and an auto-created `debts` row linked by `sale_group_id`. Two pure helpers in `src/lib/` hold all the arithmetic (recovery proportion + multi-loan receivable share) so it is unit-tested without Supabase. The existing recovery/receivables readers in `capitalApi.ts` are rewritten to fetch consumptions → sales → credit tabs and delegate to those helpers, so every consumer (Capital list, InjectionDetail, home summary card, weekly report) inherits the corrected numbers.

**Tech Stack:** React 18 + TypeScript, Vite, Supabase (Postgres + RLS), Vitest, framer-motion, Tailwind.

## Global Constraints

- Currency is Ghana Cedis; format via `formatCurrency` from `src/lib/data.ts`. Never hand-format money.
- All Supabase reads/writes are multi-tenant: every query filters `.eq('user_id', uid)` using `uidOrThrow()` (capitalApi) or `getCurrentUserId()` (supabaseApi).
- Do not introduce new `@typescript-eslint/no-explicit-any` violations. Use explicit row types on Supabase `select` results (the file has pre-existing `as any[]` in `fetchInjectionStockSummary`; do not copy that pattern).
- Credit linkage applies only to `type='owed'` debts. `'owing'` debts never get `sale_group_id`.
- Recovery is **profit × paid-fraction**; a credit sale with **no matching tab** is treated as fully paid (fraction = 1).
- TDD for pure helpers (`src/lib/*.ts`): failing test first. The API/UI layers have no existing unit tests in this repo — their gate is `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint <files>` (zero NEW problems), `npm run build`, and the stated manual check.
- `migration_017` must be applied to Supabase before credit sales work end-to-end (CHECK constraint). Ship it first.

---

### Task 1: Data model — migration_017 + types

**Files:**
- Create: `src/db/migration_017_credit_sales.sql`
- Modify: `src/lib/supabase.ts` (the `Sale` interface `payment_method` field; the `Debt` interface)

**Interfaces:**
- Produces: `Sale.payment_method` now `'cash' | 'momo' | 'bank' | 'credit'`; `Debt.sale_group_id?: string | null`.

- [ ] **Step 1: Write the migration**

Create `src/db/migration_017_credit_sales.sql`:
```sql
-- migration_017: credit sales linked to capital injections
-- A sale can be taken on credit: goods leave (stock + batch_consumptions as
-- usual) but cash is owed. The resulting tab is a debts row linked to the sale
-- via sale_group_id. The funding loan's profit-recovery is withheld until the
-- tab is paid (computed app-side from debts.amount_paid / payments).

-- 1. Allow 'credit' as a payment method.
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash','momo','bank','credit'));

-- 2. Link an auto-created tab back to its originating sale group.
ALTER TABLE debts ADD COLUMN IF NOT EXISTS sale_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_debts_sale_group ON debts(sale_group_id);
```

> Note: the live `sales` CHECK constraint may have a different name than
> `sales_payment_method_check`. The `DROP ... IF EXISTS` is a no-op if so; verify
> the actual name in Supabase (`\d sales`) when applying and adjust the DROP line
> if a differently-named CHECK on `payment_method` exists.

- [ ] **Step 2: Extend the `Sale` type**

In `src/lib/supabase.ts`, change the `Sale.payment_method` field:
```ts
  payment_method: 'cash' | 'momo' | 'bank' | 'credit'
```

- [ ] **Step 3: Extend the `Debt` type**

In `src/lib/supabase.ts`, in the `Debt` interface, below the existing
`injection_id?: string | null` line, add:
```ts
  // For credit sales: links this tab to the originating sale group.
  sale_group_id?: string | null
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no output (passes). Existing code using `payment_method` still compiles; the union only widened.

- [ ] **Step 5: Commit**

```bash
git add src/db/migration_017_credit_sales.sql src/lib/supabase.ts
git commit -m "feat: add credit payment method and debt sale_group_id link"
```

---

### Task 2: Pure recovery helper `computeRecovered`

**Files:**
- Create: `src/lib/capitalRecovery.ts`
- Test: `src/lib/capitalRecovery.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RecoveryConsumption { injection_id: string; sale_id: string; profit: number }
  export interface RecoverySale { sale_group_id: string | null; payment_method: string; created_at: string }
  export interface RecoveryTab { amount: number; amount_paid: number; payments: { amount: number; date: string }[] }
  export function computeRecovered(
    consumptions: RecoveryConsumption[],
    salesById: Record<string, RecoverySale>,
    tabsByGroup: Record<string, RecoveryTab>,
    sinceIso?: string,
  ): Record<string, number>
  ```
- Consumed by: Task 4 (`fetchRecoveredProfitMap`).

Rules: cash/momo/bank → fraction 1 (and, when `sinceIso` given, only if `created_at >= sinceIso`, else 0). credit → tab paid fraction `clamp(amount_paid/amount,0,1)`; with `sinceIso`, `clamp(sum(payments with date>=sinceIso)/amount,0,1)`. Missing sale or missing credit tab → fraction 1, ignoring `sinceIso`. `amount <= 0` → fraction 0. Output sums `profit*fraction` per `injection_id`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/capitalRecovery.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeRecovered, type RecoverySale, type RecoveryTab } from './capitalRecovery'

const cashSale: RecoverySale = { sale_group_id: 'g1', payment_method: 'cash', created_at: '2026-06-10T00:00:00Z' }
const creditSale: RecoverySale = { sale_group_id: 'g2', payment_method: 'credit', created_at: '2026-06-10T00:00:00Z' }

describe('computeRecovered', () => {
  it('counts cash-sale profit fully', () => {
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: cashSale }, {},
    )
    expect(out.A).toBe(100)
  })

  it('counts zero for an unpaid credit sale', () => {
    const tab: RecoveryTab = { amount: 50, amount_paid: 0, payments: [] }
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: creditSale }, { g2: tab },
    )
    expect(out.A).toBe(0)
  })

  it('counts credit profit proportional to amount paid', () => {
    const tab: RecoveryTab = { amount: 50, amount_paid: 40, payments: [{ amount: 40, date: '2026-06-12T00:00:00Z' }] }
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: creditSale }, { g2: tab },
    )
    expect(out.A).toBeCloseTo(80) // 40/50 = 0.8
  })

  it('treats a credit sale with no tab as fully paid', () => {
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: creditSale }, {},
    )
    expect(out.A).toBe(100)
  })

  it('splits across injections by their own consumption rows', () => {
    const out = computeRecovered(
      [
        { injection_id: 'A', sale_id: 's1', profit: 30 },
        { injection_id: 'B', sale_id: 's1', profit: 70 },
      ],
      { s1: cashSale }, {},
    )
    expect(out.A).toBe(30)
    expect(out.B).toBe(70)
  })

  it('period filter: cash counts only if sale is within period', () => {
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: cashSale }, {},
      '2026-06-15T00:00:00Z', // sale was 06-10, before cutoff
    )
    expect(out.A ?? 0).toBe(0)
  })

  it('period filter: credit counts payments landing in the period', () => {
    const tab: RecoveryTab = {
      amount: 100, amount_paid: 60,
      payments: [
        { amount: 20, date: '2026-06-01T00:00:00Z' }, // before cutoff
        { amount: 40, date: '2026-06-18T00:00:00Z' }, // in period
      ],
    }
    const out = computeRecovered(
      [{ injection_id: 'A', sale_id: 's1', profit: 100 }],
      { s1: creditSale }, { g2: tab },
      '2026-06-15T00:00:00Z',
    )
    expect(out.A).toBeCloseTo(40) // 40/100 of profit
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/capitalRecovery.test.ts`
Expected: FAIL — `Failed to resolve import './capitalRecovery'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/capitalRecovery.ts`:
```ts
// Pure profit-recovery arithmetic for capital injections. A consumption's profit
// counts toward its loan only to the extent the cash has actually arrived: cash
// sales fully, credit sales by the fraction of the tab paid. Kept Supabase-free
// so it is unit-testable.

export interface RecoveryConsumption { injection_id: string; sale_id: string; profit: number }
export interface RecoverySale { sale_group_id: string | null; payment_method: string; created_at: string }
export interface RecoveryTab { amount: number; amount_paid: number; payments: { amount: number; date: string }[] }

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function paidFraction(
  sale: RecoverySale | undefined,
  tabsByGroup: Record<string, RecoveryTab>,
  sinceIso?: string,
): number {
  // Missing sale row — count fully (we can't withhold what we can't identify).
  if (!sale) return 1

  if (sale.payment_method !== 'credit') {
    if (sinceIso && sale.created_at < sinceIso) return 0
    return 1
  }

  const tab = sale.sale_group_id ? tabsByGroup[sale.sale_group_id] : undefined
  // Credit sale with no tab — treat as fully paid.
  if (!tab) return 1
  if (tab.amount <= 0) return 0

  if (!sinceIso) return clamp01(tab.amount_paid / tab.amount)

  const paidInPeriod = (tab.payments || [])
    .filter((p) => p.date >= sinceIso)
    .reduce((s, p) => s + p.amount, 0)
  return clamp01(paidInPeriod / tab.amount)
}

export function computeRecovered(
  consumptions: RecoveryConsumption[],
  salesById: Record<string, RecoverySale>,
  tabsByGroup: Record<string, RecoveryTab>,
  sinceIso?: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of consumptions) {
    const fraction = paidFraction(salesById[c.sale_id], tabsByGroup, sinceIso)
    if (fraction === 0) continue
    out[c.injection_id] = (out[c.injection_id] || 0) + c.profit * fraction
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/capitalRecovery.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/capitalRecovery.ts src/lib/capitalRecovery.test.ts
git commit -m "feat: add pure credit-aware recovery helper"
```

---

### Task 3: Pure receivables-split helper `splitCreditReceivables`

**Files:**
- Create: `src/lib/capitalReceivables.ts`
- Test: `src/lib/capitalReceivables.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReceivableConsumption { injection_id: string; sale_group_id: string; lineValue: number }
  export interface ReceivableTab { sale_group_id: string; amount: number; amount_paid: number; is_paid: boolean }
  export interface ReceivableRow { sale_group_id: string; shareOutstanding: number; fullOutstanding: number; fullAmount: number }
  export function splitCreditReceivables(
    consumptions: ReceivableConsumption[],
    tabsByGroup: Record<string, ReceivableTab>,
  ): Record<string, ReceivableRow[]>
  ```
- Consumed by: Task 5 (`fetchReceivablesDetail`).

Rules: For each `(injection, sale_group)`, `numerator = Σ lineValue`. For each injection, for each group it touches whose tab exists and is NOT paid: `share = numerator / tab.amount` (guard `amount<=0` → share 0); `shareOutstanding = (tab.amount - tab.amount_paid) * share`; `fullOutstanding = tab.amount - tab.amount_paid`; `fullAmount = tab.amount`. One row per (injection, unpaid group). Returns map `injection_id -> rows`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/capitalReceivables.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { splitCreditReceivables, type ReceivableTab } from './capitalReceivables'

describe('splitCreditReceivables', () => {
  it('single-loan cart: share is the whole outstanding', () => {
    const tabs: Record<string, ReceivableTab> = {
      g1: { sale_group_id: 'g1', amount: 100, amount_paid: 20, is_paid: false },
    }
    const out = splitCreditReceivables(
      [{ injection_id: 'A', sale_group_id: 'g1', lineValue: 100 }],
      tabs,
    )
    expect(out.A).toHaveLength(1)
    expect(out.A[0].shareOutstanding).toBeCloseTo(80)
    expect(out.A[0].fullOutstanding).toBeCloseTo(80)
    expect(out.A[0].fullAmount).toBe(100)
  })

  it('two-loan cart: shares sum to the tab outstanding', () => {
    const tabs: Record<string, ReceivableTab> = {
      g1: { sale_group_id: 'g1', amount: 100, amount_paid: 0, is_paid: false },
    }
    const out = splitCreditReceivables(
      [
        { injection_id: 'A', sale_group_id: 'g1', lineValue: 60 },
        { injection_id: 'B', sale_group_id: 'g1', lineValue: 40 },
      ],
      tabs,
    )
    expect(out.A[0].shareOutstanding).toBeCloseTo(60)
    expect(out.B[0].shareOutstanding).toBeCloseTo(40)
    expect(out.A[0].shareOutstanding + out.B[0].shareOutstanding).toBeCloseTo(100)
  })

  it('untracked remainder: shares sum to less than outstanding', () => {
    // Cart total 100 but only 70 worth came from tracked loan A.
    const tabs: Record<string, ReceivableTab> = {
      g1: { sale_group_id: 'g1', amount: 100, amount_paid: 0, is_paid: false },
    }
    const out = splitCreditReceivables(
      [{ injection_id: 'A', sale_group_id: 'g1', lineValue: 70 }],
      tabs,
    )
    expect(out.A[0].shareOutstanding).toBeCloseTo(70)
  })

  it('excludes paid tabs', () => {
    const tabs: Record<string, ReceivableTab> = {
      g1: { sale_group_id: 'g1', amount: 100, amount_paid: 100, is_paid: true },
    }
    const out = splitCreditReceivables(
      [{ injection_id: 'A', sale_group_id: 'g1', lineValue: 100 }],
      tabs,
    )
    expect(out.A ?? []).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/capitalReceivables.test.ts`
Expected: FAIL — `Failed to resolve import './capitalReceivables'`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/capitalReceivables.ts`:
```ts
// Pure share-split arithmetic for "owed by customers" against a loan. When one
// credit cart drew on stock from several loans, the customer owes ONE tab; each
// loan's slice of that tab is its share of the cart's selling value. Supabase-free
// so it is unit-testable.

export interface ReceivableConsumption { injection_id: string; sale_group_id: string; lineValue: number }
export interface ReceivableTab { sale_group_id: string; amount: number; amount_paid: number; is_paid: boolean }
export interface ReceivableRow { sale_group_id: string; shareOutstanding: number; fullOutstanding: number; fullAmount: number }

export function splitCreditReceivables(
  consumptions: ReceivableConsumption[],
  tabsByGroup: Record<string, ReceivableTab>,
): Record<string, ReceivableRow[]> {
  // numerator[injection][group] = selling value of this loan's lines in that cart
  const numerator = new Map<string, Map<string, number>>()
  for (const c of consumptions) {
    const byGroup = numerator.get(c.injection_id) ?? new Map<string, number>()
    byGroup.set(c.sale_group_id, (byGroup.get(c.sale_group_id) || 0) + c.lineValue)
    numerator.set(c.injection_id, byGroup)
  }

  const out: Record<string, ReceivableRow[]> = {}
  for (const [injectionId, byGroup] of numerator) {
    const rows: ReceivableRow[] = []
    for (const [groupId, lineSum] of byGroup) {
      const tab = tabsByGroup[groupId]
      if (!tab || tab.is_paid || tab.amount <= 0) continue
      const share = lineSum / tab.amount
      const fullOutstanding = tab.amount - tab.amount_paid
      rows.push({
        sale_group_id: groupId,
        shareOutstanding: fullOutstanding * share,
        fullOutstanding,
        fullAmount: tab.amount,
      })
    }
    if (rows.length) out[injectionId] = rows
  }
  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/capitalReceivables.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/capitalReceivables.ts src/lib/capitalReceivables.test.ts
git commit -m "feat: add pure receivable share-split helper"
```

---

### Task 4: Make recovery readers credit-aware (`capitalApi.ts`)

**Files:**
- Modify: `src/services/capitalApi.ts` (`fetchRecoveredProfit`, `fetchRecoveredProfitMap`)

**Interfaces:**
- Consumes: `computeRecovered`, `RecoverySale`, `RecoveryTab` from `src/lib/capitalRecovery.ts`.
- Produces: same signatures as today — `fetchRecoveredProfit(injectionId): Promise<number>`, `fetchRecoveredProfitMap(injectionIds, sinceIso?): Promise<Record<string, number>>`. Behaviour now credit-aware; all callers (Capital, InjectionDetail, CapitalSummaryCard via `fetchCapitalSummary`, CapitalReportSection) inherit it unchanged.

- [ ] **Step 1: Add the import**

At the top of `src/services/capitalApi.ts`, after the existing
`import { summarizeInjectionStock } ...` line, add:
```ts
import { computeRecovered, type RecoverySale, type RecoveryTab } from '@/lib/capitalRecovery'
```

- [ ] **Step 2: Replace `fetchRecoveredProfit`**

Replace the whole existing `fetchRecoveredProfit` function body with a delegation
to the map (single source of truth for the arithmetic):
```ts
// Cumulative profit recovered from the stock this injection funded, withholding
// credit sales until paid. Powers the risk engine and the report.
export async function fetchRecoveredProfit(injectionId: string): Promise<number> {
  const map = await fetchRecoveredProfitMap([injectionId])
  return map[injectionId] || 0
}
```

- [ ] **Step 3: Replace `fetchRecoveredProfitMap`**

Replace the whole existing `fetchRecoveredProfitMap` function with:
```ts
// Recovered profit per injection. Pass sinceIso to restrict to a period (credit
// profit is then counted by when its payments landed, not when goods left).
export async function fetchRecoveredProfitMap(injectionIds: string[], sinceIso?: string): Promise<Record<string, number>> {
  const uid = await uidOrThrow()
  if (injectionIds.length === 0) return {}

  // 1. Consumptions of these injections.
  const { data: consData, error } = await supabase
    .from('batch_consumptions')
    .select('injection_id, sale_id, profit')
    .in('injection_id', injectionIds)
    .eq('user_id', uid)
  if (error) throw error
  const consumptions = (consData as { injection_id: string; sale_id: string; profit: number }[] | null) || []
  if (consumptions.length === 0) return {}

  // 2. The sales those consumptions belong to (for method + group).
  const saleIds = Array.from(new Set(consumptions.map((c) => c.sale_id).filter(Boolean)))
  const salesById: Record<string, RecoverySale> = {}
  if (saleIds.length) {
    const { data: salesData } = await supabase
      .from('sales')
      .select('id, sale_group_id, payment_method, created_at')
      .in('id', saleIds)
      .eq('user_id', uid)
    for (const s of (salesData as { id: string; sale_group_id: string | null; payment_method: string; created_at: string }[] | null) || []) {
      salesById[s.id] = { sale_group_id: s.sale_group_id, payment_method: s.payment_method, created_at: s.created_at }
    }
  }

  // 3. Credit tabs for the credit sales, keyed by sale_group_id.
  const creditGroups = Array.from(new Set(
    Object.values(salesById)
      .filter((s) => s.payment_method === 'credit' && s.sale_group_id)
      .map((s) => s.sale_group_id as string),
  ))
  const tabsByGroup: Record<string, RecoveryTab> = {}
  if (creditGroups.length) {
    const { data: tabsData } = await supabase
      .from('debts')
      .select('sale_group_id, amount, amount_paid, payments')
      .in('sale_group_id', creditGroups)
      .eq('user_id', uid)
    for (const t of (tabsData as { sale_group_id: string; amount: number; amount_paid: number | null; payments: { amount: number; date: string }[] | null }[] | null) || []) {
      tabsByGroup[t.sale_group_id] = { amount: t.amount, amount_paid: t.amount_paid || 0, payments: t.payments || [] }
    }
  }

  return computeRecovered(consumptions, salesById, tabsByGroup, sinceIso)
}
```

- [ ] **Step 4: Typecheck, lint, and run the existing capital tests**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no output.

Run: `npx eslint src/services/capitalApi.ts`
Expected: no NEW errors beyond the pre-existing `any` warnings in `fetchInjectionStockSummary` (lines unchanged by this task). If your edits introduced a new error, fix it.

Run: `npx vitest run`
Expected: all existing suites still PASS (33 prior + 11 new from Tasks 2–3 = 44).

- [ ] **Step 5: Commit**

```bash
git add src/services/capitalApi.ts
git commit -m "feat: withhold credit-sale profit from loan recovery until paid"
```

---

### Task 5: Make receivables readers share-split + credit-aware (`capitalApi.ts`, `InjectionDetail.tsx`)

**Files:**
- Modify: `src/services/capitalApi.ts` (`InjectionReceivable` interface, `fetchInjectionReceivables`, `fetchReceivablesMap`; add internal `fetchReceivablesDetail`)
- Modify: `src/pages/InjectionDetail.tsx` (render attributable amount + "part of tab" note)

**Interfaces:**
- Consumes: `splitCreditReceivables`, `ReceivableConsumption`, `ReceivableTab` from `src/lib/capitalReceivables.ts`.
- Produces (replaces the migration_016 shape):
  ```ts
  export interface InjectionReceivable {
    id: string
    person_name: string
    phone: string | null
    outstanding: number      // attributable to THIS loan (share-split for credit; full for manual)
    fullOutstanding: number  // the whole tab's outstanding
    fullAmount: number       // the whole tab's total
    isCredit: boolean        // true = from a credit sale (share-split); false = manual tag
    is_paid: boolean
    due_date: string | null
  }
  ```
  `fetchInjectionReceivables(injectionId): Promise<InjectionReceivable[]>` and
  `fetchReceivablesMap(injectionIds): Promise<Record<string, { outstanding: number; count: number }>>` keep their names; `Capital.tsx` consumes the map unchanged.

- [ ] **Step 1: Add the import**

In `src/services/capitalApi.ts`, after the `computeRecovered` import added in Task 4, add:
```ts
import { splitCreditReceivables, type ReceivableConsumption, type ReceivableTab } from '@/lib/capitalReceivables'
```

- [ ] **Step 2: Replace the `InjectionReceivable` interface and both receivables functions**

Find the block added in migration_016 — the `InjectionReceivable` interface,
`fetchInjectionReceivables`, and `fetchReceivablesMap`. Replace that entire block with:
```ts
// ── Receivables: customers who owe against a loan ────────────────────────────
// Two sources are unioned per loan:
//  • manual debts tagged injection_id = X (shown at full outstanding)
//  • credit-sale debts whose cart consumed stock from X (shown at the loan's
//    share of the tab — its lines' selling value / tab total)
export interface InjectionReceivable {
  id: string
  person_name: string
  phone: string | null
  outstanding: number
  fullOutstanding: number
  fullAmount: number
  isCredit: boolean
  is_paid: boolean
  due_date: string | null
}

// Builds attributable receivable rows per injection for the given ids.
async function fetchReceivablesDetail(injectionIds: string[]): Promise<Record<string, InjectionReceivable[]>> {
  const uid = await uidOrThrow()
  const result: Record<string, InjectionReceivable[]> = {}
  if (injectionIds.length === 0) return result

  // — Manual debts: directly tagged to a loan, not from a sale —
  const { data: manualData, error: manualErr } = await supabase
    .from('debts')
    .select('id, person_name, phone, amount, amount_paid, is_paid, due_date, injection_id')
    .in('injection_id', injectionIds)
    .eq('user_id', uid)
    .eq('type', 'owed')
    .is('sale_group_id', null)
    .eq('is_paid', false)
  if (manualErr) throw manualErr
  for (const d of (manualData as { id: string; person_name: string; phone: string | null; amount: number; amount_paid: number | null; is_paid: boolean; due_date: string | null; injection_id: string }[] | null) || []) {
    const outstanding = Math.max(0, d.amount - (d.amount_paid || 0))
    ;(result[d.injection_id] ||= []).push({
      id: d.id, person_name: d.person_name, phone: d.phone,
      outstanding, fullOutstanding: outstanding, fullAmount: d.amount,
      isCredit: false, is_paid: d.is_paid, due_date: d.due_date,
    })
  }

  // — Credit-sale debts: reached via the loan's consumed stock —
  const { data: consData } = await supabase
    .from('batch_consumptions')
    .select('injection_id, sale_id, qty, unit_price')
    .in('injection_id', injectionIds)
    .eq('user_id', uid)
  const cons = (consData as { injection_id: string; sale_id: string; qty: number; unit_price: number }[] | null) || []
  if (cons.length) {
    const saleIds = Array.from(new Set(cons.map((c) => c.sale_id).filter(Boolean)))
    const groupBySale: Record<string, string | null> = {}
    const methodBySale: Record<string, string> = {}
    if (saleIds.length) {
      const { data: salesData } = await supabase
        .from('sales')
        .select('id, sale_group_id, payment_method')
        .in('id', saleIds)
        .eq('user_id', uid)
      for (const s of (salesData as { id: string; sale_group_id: string | null; payment_method: string }[] | null) || []) {
        groupBySale[s.id] = s.sale_group_id
        methodBySale[s.id] = s.payment_method
      }
    }
    // Keep only consumptions belonging to a credit sale with a group id.
    const recvCons: ReceivableConsumption[] = cons
      .filter((c) => methodBySale[c.sale_id] === 'credit' && groupBySale[c.sale_id])
      .map((c) => ({ injection_id: c.injection_id, sale_group_id: groupBySale[c.sale_id] as string, lineValue: c.qty * c.unit_price }))

    const creditGroups = Array.from(new Set(recvCons.map((c) => c.sale_group_id)))
    const tabsByGroup: Record<string, ReceivableTab> = {}
    const tabMeta: Record<string, { id: string; person_name: string; phone: string | null; due_date: string | null }> = {}
    if (creditGroups.length) {
      const { data: tabsData } = await supabase
        .from('debts')
        .select('id, sale_group_id, person_name, phone, amount, amount_paid, is_paid, due_date')
        .in('sale_group_id', creditGroups)
        .eq('user_id', uid)
      for (const t of (tabsData as { id: string; sale_group_id: string; person_name: string; phone: string | null; amount: number; amount_paid: number | null; is_paid: boolean; due_date: string | null }[] | null) || []) {
        tabsByGroup[t.sale_group_id] = { sale_group_id: t.sale_group_id, amount: t.amount, amount_paid: t.amount_paid || 0, is_paid: t.is_paid }
        tabMeta[t.sale_group_id] = { id: t.id, person_name: t.person_name, phone: t.phone, due_date: t.due_date }
      }
    }

    const split = splitCreditReceivables(recvCons, tabsByGroup)
    for (const [injectionId, rows] of Object.entries(split)) {
      for (const r of rows) {
        const meta = tabMeta[r.sale_group_id]
        if (!meta) continue
        ;(result[injectionId] ||= []).push({
          id: meta.id, person_name: meta.person_name, phone: meta.phone,
          outstanding: r.shareOutstanding, fullOutstanding: r.fullOutstanding, fullAmount: r.fullAmount,
          isCredit: true, is_paid: false, due_date: meta.due_date,
        })
      }
    }
  }

  return result
}

export async function fetchInjectionReceivables(injectionId: string): Promise<InjectionReceivable[]> {
  const detail = await fetchReceivablesDetail([injectionId])
  return detail[injectionId] || []
}

export async function fetchReceivablesMap(
  injectionIds: string[],
): Promise<Record<string, { outstanding: number; count: number }>> {
  const detail = await fetchReceivablesDetail(injectionIds)
  const map: Record<string, { outstanding: number; count: number }> = {}
  for (const [injectionId, rows] of Object.entries(detail)) {
    map[injectionId] = {
      outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      count: rows.length,
    }
  }
  return map
}
```

> The migration_016 version exported `amount`/`amount_paid` on `InjectionReceivable`
> and had a separate `fetchReceivablesMap` that read `is_paid=false` directly.
> Both are fully replaced here; no other code references the removed fields except
> `InjectionDetail.tsx`, updated next.

- [ ] **Step 3: Update the InjectionDetail receivables card**

In `src/pages/InjectionDetail.tsx`, the "Credit given from this stock" card (added
in migration_016) references `r.outstanding`, `r.amount_paid`, `r.is_paid`. Replace
the card's body so it uses the new attributable fields and shows the full-tab note.
Find the IIFE that starts `{(() => { const open = receivables.filter(...)` and
replace it with:
```tsx
        {/* 4b. Credit given — customers who owe against this capital */}
        {(() => {
          const open = receivables.filter((r) => !r.is_paid)
          const owedTotal = open.reduce((s, r) => s + r.outstanding, 0)
          if (receivables.length === 0) return null
          return (
            <div className="bg-white harsh-border rounded-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium flex items-center gap-1.5"><Users size={14} /> Credit given from this stock</p>
                <span className="font-display text-base text-accent-red">{formatCurrency(owedTotal)}</span>
              </div>
              <p className="text-[11px] text-muted-text mb-3">
                {open.length} {open.length === 1 ? 'person owes' : 'people owe'} you for goods taken on credit against this loan
              </p>
              <div className="space-y-1.5 text-sm">
                {receivables.map((r, i) => {
                  const overdue = !r.is_paid && r.due_date && new Date(r.due_date).getTime() <= Date.now()
                  const partial = r.isCredit && r.outstanding < r.fullOutstanding - 0.01
                  return (
                    <div key={`${r.id}-${i}`} className="flex justify-between">
                      <span className={r.is_paid ? 'text-muted-text line-through' : ''}>
                        {r.is_paid ? '✅' : overdue ? '🔴' : '🔔'} {r.person_name}
                        {partial && <span className="text-muted-text"> · part of {formatCurrency(r.fullAmount)} tab</span>}
                        {r.due_date && !r.is_paid && <span className="text-muted-text"> · due {formatDate(r.due_date)}</span>}
                      </span>
                      <span className={r.is_paid ? 'text-accent-green' : overdue ? 'text-accent-red' : 'text-muted-text'}>
                        {r.is_paid ? 'paid' : formatCurrency(r.outstanding)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-text mt-3 pt-2 border-t border-gray-200">
                Credit sales tag here automatically. Record payments from the <strong>Debts</strong> page and recovery updates live.
              </p>
            </div>
          )
        })()}
```

> This removes the prior `collected` line (which used `amount_paid`, no longer on
> the type). The `Users` icon import and `receivables` state already exist from
> migration_016.

- [ ] **Step 4: Typecheck, lint, build**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no output.

Run: `npx eslint src/services/capitalApi.ts src/pages/InjectionDetail.tsx`
Expected: no NEW problems (pre-existing `any` warnings in `fetchInjectionStockSummary` and the pre-existing `useEffect` dep warning in InjectionDetail are acceptable; do not add new ones).

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/services/capitalApi.ts src/pages/InjectionDetail.tsx
git commit -m "feat: split credit receivables across loans by selling-value share"
```

---

### Task 6: Credit sale flow in `AddSaleSheet.tsx`

**Files:**
- Modify: `src/components/AddSaleSheet.tsx`

**Interfaces:**
- Consumes: `addDebt` from `useStore()` (existing: `addDebt(debt: Omit<Debt,'user_id'>): Promise<void>`), `uid` from `src/lib/data.ts`, the `groupId` already generated in `handleConfirm`.
- Produces: a `debts` row with `type='owed'`, `amount` = cart total, `amount_paid` = deposit, `sale_group_id` = the sale group id, `injection_id` = null.

- [ ] **Step 1: Widen the payment-method state and add credit inputs state**

In `AddSaleSheet.tsx`, change the `paymentMethod` state type to include credit, and
add three pieces of credit state. Replace:
```ts
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo' | 'bank'>('cash')
```
with:
```ts
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo' | 'bank' | 'credit'>('cash')
  const [depositInput, setDepositInput] = useState('')
  const [creditDueDate, setCreditDueDate] = useState('')
```

Also pull `addDebt` from the store. Change:
```ts
  const { state, dispatch, showToast, addSaleBatch, updateCustomer, addCustomer } = useStore()
```
to:
```ts
  const { state, dispatch, showToast, addSaleBatch, updateCustomer, addCustomer, addDebt } = useStore()
```

- [ ] **Step 2: Reset the new fields on close**

In `handleClose`, after `setPaymentMethod('cash')`, add:
```ts
    setDepositInput('')
    setCreditDueDate('')
```

- [ ] **Step 3: Add the CREDIT button to the payment options**

Change the `paymentOptions` array to include credit:
```ts
  const paymentOptions: { key: 'cash' | 'momo' | 'bank' | 'credit'; label: string }[] = [
    { key: 'cash', label: 'CASH' },
    { key: 'momo', label: 'MOMO' },
    { key: 'bank', label: 'BANK' },
    { key: 'credit', label: 'CREDIT' },
  ]
```

- [ ] **Step 4: Show credit fields and import `Debt` type**

At the top of the file, extend the existing supabase import. If there is no type
import yet, add one:
```ts
import type { Debt } from '@/lib/supabase'
```

Then, in the cart view, immediately AFTER the closing `</div>` of the Payment
Method block (the block whose header is `PAYMENT METHOD`) and BEFORE the Customer
block, insert the credit panel:
```tsx
                      {/* Credit terms — only when CREDIT is the method */}
                      {paymentMethod === 'credit' && (
                        <div className="mb-4 bg-light harsh-border rounded-sm p-3 space-y-3">
                          <p className="text-micro text-muted-text">CREDIT (PAY LATER) — customer name required below</p>
                          <div>
                            <label className="text-micro text-muted-text mb-1.5 block">Paid now (deposit, optional)</label>
                            <input
                              type="number"
                              inputMode="decimal"
                              value={depositInput}
                              onChange={(e) => setDepositInput(e.target.value)}
                              placeholder="0.00"
                              className="w-full h-12 px-4 bg-sand harsh-border rounded-sm text-base font-body"
                            />
                          </div>
                          <div>
                            <label className="text-micro text-muted-text mb-1.5 block">Due date (optional)</label>
                            <input
                              type="date"
                              value={creditDueDate}
                              onChange={(e) => setCreditDueDate(e.target.value)}
                              className="w-full h-12 px-4 bg-sand harsh-border rounded-sm text-base font-body"
                            />
                          </div>
                        </div>
                      )}
```

> When `paymentMethod === 'credit'`, the customer form should be visible so the
> name can be entered. Force it open: in the same render, the Customer block is
> gated by `showCustomerForm`. Change the toggle’s initial visibility by updating
> the Customer block condition from `{showCustomerForm && (` to
> `{(showCustomerForm || paymentMethod === 'credit') && (`.

- [ ] **Step 5: Enforce name + create the tab on confirm**

In `handleConfirm`, at the very start of the function body (before `setSaving(true)`),
add the guard:
```ts
    if (cart.length === 0) return
    if (paymentMethod === 'credit' && !customerName.trim()) {
      showToast('Customer name is required for credit', 'error')
      return
    }
```
(Remove the now-duplicate leading `if (cart.length === 0) return` that was already there.)

Then, after the existing `await addSaleBatch(sales, items)` call succeeds and BEFORE
the customer upsert block, add the tab creation:
```ts
      // Credit sale → create the customer's tab linked to this sale group.
      if (paymentMethod === 'credit') {
        const deposit = Math.min(Math.max(0, parseFloat(depositInput) || 0), total)
        const nowIso = createdAt
        await addDebt({
          id: uid(),
          person_name: customerName.trim(),
          phone: customerPhone || null,
          amount: total,
          amount_paid: deposit,
          payments: deposit > 0 ? [{ amount: deposit, date: nowIso }] : [],
          description: `${itemCount} ${itemCount === 1 ? 'item' : 'items'} on credit`,
          type: 'owed',
          due_date: creditDueDate || null,
          injection_id: null,
          sale_group_id: groupId,
          is_paid: deposit >= total - 0.001,
          paid_at: deposit >= total - 0.001 ? nowIso : null,
          created_at: nowIso,
        } as Omit<Debt, 'user_id'>)
      }
```

> `total`, `itemCount`, `createdAt`, and `groupId` are all already in scope inside
> `handleConfirm`. The `as Omit<Debt, 'user_id'>` keeps TS happy since `payments`
> uses the `DebtPayment` shape `{ amount, date }`.

- [ ] **Step 6: Typecheck, lint, build**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no output.

Run: `npx eslint src/components/AddSaleSheet.tsx`
Expected: no new problems.

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 7: Manual verification**

Run `npm run dev`. With migration_017 applied to the dev Supabase project:
1. Add a product (so stock exists, ideally received against a capital injection).
2. Open the add-sale sheet, add the product to the cart, choose **CREDIT**.
3. Confirm without a name → blocked with the toast.
4. Enter a customer name, optional deposit (e.g. partial), confirm → "Sale recorded".
5. Go to **Debts → Who owes me**: a tab exists for that customer, amount = cart
   total, paid = deposit.
6. Go to **Capital → that loan**: the customer appears under "Credit given from
   this stock"; the recovery bar reflects only the deposit's share of profit.

- [ ] **Step 8: Commit**

```bash
git add src/components/AddSaleSheet.tsx
git commit -m "feat: credit sales create a capital-linked customer tab"
```

---

### Task 7: Cascade tab deletion when a credit sale is deleted

**Files:**
- Modify: `src/services/supabaseApi.ts` (`deleteSaleGroup`)

**Interfaces:**
- Consumes: the `sales: Sale[]` passed to `deleteSaleGroup` (each carries `sale_group_id`).
- Produces: deleting a credit sale group also deletes its linked `debts` row, so the two never drift.

- [ ] **Step 1: Read the current `deleteSaleGroup`**

Open `src/services/supabaseApi.ts` around line 198 to see the existing deletion
logic (it deletes the sale rows, and may restock / undo customer totals).

- [ ] **Step 2: Delete the linked tab(s)**

Inside `deleteSaleGroup`, after the sales rows are deleted, add a cleanup of any
debt linked to the same `sale_group_id`(s). Add this near the end of the function,
before it returns (uses the same `uid` already resolved in the function):
```ts
  // If any of these sales were on credit, remove the linked customer tab(s).
  const groupIds = Array.from(new Set(sales.map((s) => s.sale_group_id).filter(Boolean))) as string[]
  if (groupIds.length) {
    await supabase.from('debts').delete().in('sale_group_id', groupIds).eq('user_id', uid)
  }
```

> If `deleteSaleGroup` does not already have a `uid` in scope, add
> `const uid = await getCurrentUserId(); if (!uid) throw new Error('Not authenticated')`
> at the top of the function, matching the pattern used by the other functions in
> this file.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: no output.

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Manual verification**

In the running dev app: create a credit sale (Task 6), confirm the tab exists in
Debts, then delete that sale from **Sales history**. The tab disappears from Debts,
and the loan's "Credit given" card no longer lists that customer.

- [ ] **Step 5: Commit**

```bash
git add src/services/supabaseApi.ts
git commit -m "feat: deleting a credit sale removes its linked customer tab"
```

---

## Self-Review Notes (resolved)

- **Spec coverage:** §1 data model → Task 1; §2 sale flow → Task 6; §3 recovery →
  Tasks 2 + 4; §4 receivables → Tasks 3 + 5; §5 lifecycle → Tasks 6 (orphan rule
  lives in `computeRecovered`, Task 2) + 7. §6 "payment label" files need no change
  (rendering is `.toUpperCase()`/raw — verified), so no task; the only new label is
  the hardcoded CREDIT button in Task 6. §7 testing → Tasks 2 & 3 unit tests.
- **Type consistency:** `RecoveryConsumption/RecoverySale/RecoveryTab` (Task 2) used
  verbatim in Task 4; `ReceivableConsumption/ReceivableTab/ReceivableRow` (Task 3)
  used verbatim in Task 5; `InjectionReceivable` redefined in Task 5 and consumed by
  InjectionDetail in the same task; `addDebt` signature matches `store.tsx`.
- **Placeholders:** none — every code step shows full code.
```
