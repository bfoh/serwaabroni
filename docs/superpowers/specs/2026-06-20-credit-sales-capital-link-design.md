# Credit Sales → Capital-Linked Debts — Design Spec

**Date:** 2026-06-20
**Status:** Approved, ready for implementation plan
**Depends on:** migration_016 (adds `debts.injection_id`, already implemented)

## Problem

A vendor buys stock with a loan (a capital injection). A customer takes some of
that stock **on credit** — goods leave the shop, cash does not. Today the app
forces two manual, disconnected actions: record a sale (counts as paid) *and*
record a debt. The two never reconcile, and the loan's "recovered" bar fills
from profit the moment goods leave — overstating how much of the loan has
actually been earned back, because the cash is still in the customer's hands.

## Goal

Let a sale be marked **CREDIT** at the point of sale. The app then:
1. Records the sale (stock leaves via FIFO, exactly as today).
2. Auto-creates **one** "who owes me" debt (the customer's tab) linked to that sale.
3. Withholds that sale's profit from the funding loan's recovery until the
   customer pays, crediting it **proportionally** as payments land — and
   splitting correctly across loans when one cart drew on stock from several.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Does credit-sale profit count toward loan recovery on sale, or on payment? | **On payment** |
| 2 | Partial payments — proportional or all-or-nothing? | **Proportional** |
| 3 | Deposit allowed at point of sale? | **Yes** |
| 4 | Multi-loan cart — how is the tab shown per loan? | **Split by each loan's selling-value share** |

## Non-goals

- No change to the risk engine itself. It keeps reading the (now credit-aware)
  recovered number; lagging recovery naturally pushes a loan toward "at risk".
- No change to the weekly *sales-velocity* report (`buildWeeklyReport` / units &
  gross profit sold). That measures throughput, not cash recovery.
- No new "credit" concept on the `'owing'` (money you owe) side. Credit linkage
  is `type='owed'` only.

---

## 1. Data model changes

### 1.1 `sales.payment_method` — add `'credit'`
Migration drops and re-adds the CHECK constraint:
```sql
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash','momo','bank','credit'));
```
- `Sale.payment_method` union in `src/lib/supabase.ts` → add `'credit'`.
- Label/display maps that switch on payment method get a "Credit" case:
  `src/pages/SalesHistory.tsx`, `src/components/ReceiptModal.tsx`,
  `src/lib/export.ts`, and any `i18n` keys for payment labels.

### 1.2 `debts.sale_group_id` — link a tab to its originating sale
```sql
ALTER TABLE debts ADD COLUMN IF NOT EXISTS sale_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_debts_sale_group ON debts(sale_group_id);
```
- `Debt` interface → add `sale_group_id?: string | null`.
- `injection_id` (migration_016) stays for **manual** tagging. The two linkage
  mechanisms are unioned at read time (see §4). Auto credit tabs set
  `sale_group_id` and leave `injection_id` null.

### 1.3 No new tables
`batch_consumptions` already carries everything attribution needs: `sale_id`,
`injection_id`, `qty`, `unit_price`, `profit`.

---

## 2. Credit sale flow (`src/components/AddSaleSheet.tsx`)

- Add a 4th payment-method button: **CREDIT** (alongside CASH / MOMO / BANK).
- When CREDIT is selected, reveal:
  - **Customer name — required.** It's a tab; the sale cannot confirm without a
    name. (Phone stays optional, as today, but enables reminders.)
  - **"Paid now" deposit** — optional numeric field, default empty (= 0),
    clamped to `[0, total]`.
  - **Due date** — optional date.
- On confirm:
  1. Record the sale batch exactly as today, but with `payment_method='credit'`
     on each line. Stock leaves, `batch_consumptions` are created. `groupId`
     (already generated in `handleConfirm`) is the sale group id.
  2. Create **one** debt via the existing `addDebt`:
     ```
     type:           'owed'
     person_name:    customerName            (required)
     phone:          customerPhone || null
     amount:         cart total
     amount_paid:    deposit                 (0 if none)
     payments:       deposit > 0 ? [{ amount: deposit, date: now }] : []
     is_paid:        deposit >= total
     paid_at:        is_paid ? now : null
     description:    item summary (e.g. "3 items on credit") — optional
     due_date:       chosen date || null
     sale_group_id:  groupId
     injection_id:   null
     created_at:     same timestamp as the sale
     ```
- Validation: CREDIT + empty name → block with a toast, do not record the sale.
- Customer upsert (existing logic that saves/updates `customers`) runs for credit
  sales too, since a name is present.
- Receipt send (existing) still fires if a phone/email is on file.

**Offline:** if `addSaleBatch` falls back to local, still create the debt locally
(`addDebt` already has a local fallback). Server-side consumptions don't exist
until sync, so loan attribution for this tab appears after the sale syncs.
Documented, acceptable degradation.

---

## 3. Recovery math (`src/services/capitalApi.ts`)

Rewrite the two existing recovery readers to be credit-aware. They are the single
injection point — Capital list, InjectionDetail, `fetchCapitalSummary`, and
`CapitalReportSection` all inherit the corrected behaviour.

### 3.1 Per-consumption paid fraction
For each `batch_consumption` of a loan, find its sale's `payment_method` and
`sale_group_id`:
- **cash / momo / bank** → `paidFraction = 1`, recovery dated at the sale's time.
- **credit** → look up the tab by `sale_group_id`:
  - `paidFraction = clamp(amount_paid / amount, 0, 1)`.
  - **No matching tab found** (e.g. tab manually deleted) → `paidFraction = 1`
    (treat as paid; the debt is the only thing that withholds recovery).
- **recovered(loan) = Σ over its consumptions of `profit × paidFraction`.**

### 3.2 Period-restricted recovery (`sinceIso`)
Used by `CapitalReportSection` ("recovered this week/month"). Recovery is dated by
**when the cash arrived**, not when goods left:
- cash/momo/bank consumption → counts in the period containing the **sale**
  `created_at` (unchanged from today).
- credit consumption → counts `profit × (Σ payments with date ≥ sinceIso / amount)`,
  using the dated entries in `debts.payments[]`.

### 3.3 Implementation shape
`fetchRecoveredProfit(injectionId)` and
`fetchRecoveredProfitMap(injectionIds, sinceIso?)` each:
1. Fetch the relevant `batch_consumptions` (`sale_id`, `qty`, `unit_price`,
   `profit`, `injection_id`).
2. Fetch the `sales` for those `sale_id`s (`id`, `sale_group_id`,
   `payment_method`).
3. Fetch the credit `debts` by `sale_group_id` (`amount`, `amount_paid`,
   `payments`).
4. Compute per §3.1 / §3.2 client-side. ~3 queries; batched for the map variant.

A pure helper (e.g. `computeRecovered(consumptions, salesById, tabsByGroup, sinceIso?)`)
holds the arithmetic so it is unit-testable without Supabase.

---

## 4. Receivables display ("owed by customers", split by share)

Rework the receivables readers added alongside migration_016
(`fetchInjectionReceivables`, `fetchReceivablesMap`). For a loan X, union two
sources:

- **Manual debts** where `injection_id = X` → shown at **full** outstanding
  (`amount − amount_paid`); no cart, nothing to split.
- **Credit-sale debts** whose cart consumed stock from X → shown at
  `outstanding × shareX`, where
  `shareX = (Σ qty×unit_price of X's lines in that cart) / debt.amount`.
  Denominator is the tab total itself, so no need to fetch other loans' stock.
  Per-loan totals stay honest and never double-count across loans.

Display rules:
- Per credit row, note the full tab so the split amount reads sensibly, e.g.
  `Ama — GHC 6.00 (part of GHC 10.00 tab)`.
- A debt counts as outstanding for the card/aggregates only while `is_paid=false`.
- `fetchReceivablesMap` returns `{ outstanding, count }` per loan as today, with
  `outstanding` now being the share-split sum.

The `InjectionDetail` "Credit given from this stock" card and `Capital` list line
+ header stat already exist; they consume the reworked numbers unchanged.

---

## 5. Sale / debt lifecycle coupling

- **Deleting a credit sale group** (`deleteSaleGroup` / store `deleteSale`) also
  deletes the linked debt (match on `sale_group_id`). Keeps the two from drifting.
- **Deleting just the tab** (Debts page) leaves the sale; by §3.1 the orphaned
  credit sale is then treated as fully paid (profit counts). This is the
  "they paid cash / write-off" path and is acceptable.
- Recording payments against the tab uses the **existing** Debts payment flow
  unchanged; recovery and receivables recompute on next read because they derive
  from `amount_paid` / `payments[]`.

---

## 6. Files touched (summary)

| File | Change |
|------|--------|
| `src/db/migration_017_credit_sales.sql` (new) | `sales` constraint + `debts.sale_group_id` + index |
| `src/lib/supabase.ts` | `Sale.payment_method` adds `'credit'`; `Debt.sale_group_id` |
| `src/components/AddSaleSheet.tsx` | CREDIT button, required name, deposit, due date, auto-debt |
| `src/services/capitalApi.ts` | credit-aware recovery + share-split receivables; pure helpers |
| `src/services/supabaseApi.ts` | `deleteSaleGroup` cascades to linked debt |
| `src/lib/store.tsx` | thread credit debt creation / cascade through sale actions if needed |
| `src/pages/SalesHistory.tsx`, `src/components/ReceiptModal.tsx`, `src/lib/export.ts`, `src/lib/i18n.ts` | "Credit" payment label |
| `src/pages/InjectionDetail.tsx`, `src/pages/Capital.tsx` | consume reworked numbers (display tweaks for "part of tab") |

## 7. Testing

- **Pure recovery helper** (`computeRecovered`): cash full-count; credit zero when
  unpaid; credit proportional at 50%; credit 100% = full; multi-loan split;
  missing-tab = paid; `sinceIso` period bucketing by payment date.
- **Pure share-split helper**: single-loan share = 1; two-loan split sums to
  outstanding; untracked remainder leaves shares < 1.
- Follow the existing `*.test.ts` pattern in `src/lib/` (vitest). Extract the
  arithmetic into `src/lib/` so it tests without Supabase.

## 8. Rollout note

`migration_017` must run on Supabase before credit sales work end-to-end. Until
then, `payment_method='credit'` inserts fail the CHECK and the sale falls back to
local-only. Ship the migration first.
