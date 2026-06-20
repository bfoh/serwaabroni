# Cash Ledger (Cash in Hand + Cash in Bank) — Design Spec

**Date:** 2026-06-20
**Status:** Approved, ready for implementation plan
**Prereqs:** migrations 016–018 applied (this work adds 019).

## Problem

Cash in hand is derived ad-hoc as `sales − expenses − unpaidCreditSales`. It is
incomplete and fragile:
- Loan/installment repayments and stock purchases never reduce it.
- Manual debtor collections only reflect mid-session, not after a reload.
- There is no concept of money in the bank.

The owner needs an accurate, auditable picture of where money actually sits and
every movement in/out of the business.

## Goal

A single **cash ledger** (`cash_movements`) is the source of truth for two
balances — **Cash in Hand** and **Cash in Bank**. Every money event posts a
signed row; balances are sums. Inflows (sales, debtor payments) and outflows
(expenses, loan repayments, debts you owe, stock purchases, bank transfers,
adjustments) are all recorded against a chosen account.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Storage model | **Ledger** — `cash_movements` is the single source of truth |
| 2 | Sale → account | **Split by method**: cash→hand; momo/bank→bank; credit→deposit posts to cash |
| 3 | Outflow source account | **Per-outflow choice** of cash or bank |
| 4 | Backfill at launch | **Keep current figures** (backfill only already-counted events); new outflow types count from launch; manual adjustment entry available |

## Non-goals

- No supplier-credit accounting beyond a single "unpaid" toggle on stock receipt
  (skips the cash movement; does not create an `owing` debt automatically).
- No multi-currency, no reconciliation/bank-statement import.
- Risk engine, capital recovery, FIFO, and existing reports are unchanged.

## Expected launch effect (accepted)

Because momo/bank sales now correctly post to **bank** instead of the drawer,
**Cash in Hand drops** by historical momo/bank sales and the same amount appears
under **Cash in Bank**. **Total (hand + bank) is unchanged.** This is decision #2
working as intended; the manual adjustment entry corrects either account.

---

## 1. Data model — `cash_movements` (migration_019)

```sql
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account TEXT NOT NULL CHECK (account IN ('cash','bank')),
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'sale','debtor_payment','expense','loan_repayment','debt_repayment',
    'stock_purchase','bank_deposit','bank_withdrawal','adjustment')),
  ref_table TEXT,            -- 'sales'|'debts'|'expenses'|'capital_injections'|'stock_batches'|null
  ref_id TEXT,               -- the originating row id (e.g. sale_group_id, debt id)
  transfer_id UUID,          -- groups the two legs of a cash<->bank transfer
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
```

**Backfill (in the same migration, idempotent):** insert movements only for
events already reflected in today's cash figure, so balances don't jump:
- One `sale` IN row per sale group: account by `payment_method`
  (`cash`→cash; `momo`/`bank`→bank); for `credit` sales, a `sale` IN row to
  **cash** for the tab's `amount_paid` (the deposit + any payments to date).
- One `expense` OUT row per expense → **cash**.
Guarded with `WHERE NOT EXISTS (... ref match ...)` so re-running is safe.

> Loan repayments (`amount_repaid`) and stock purchases (`stock_batches`) are
> NOT backfilled (decision #4) — they begin posting at launch.

---

## 2. Service layer — `src/services/cashApi.ts` (new)

Single module owning all ledger writes/reads. Pure helpers split out for tests.

```ts
export type CashAccount = 'cash' | 'bank'
export type CashCategory =
  | 'sale' | 'debtor_payment' | 'expense' | 'loan_repayment' | 'debt_repayment'
  | 'stock_purchase' | 'bank_deposit' | 'bank_withdrawal' | 'adjustment'

export interface CashMovement {
  id: string; user_id: string; account: CashAccount; direction: 'in' | 'out'
  amount: number; category: CashCategory; ref_table: string | null
  ref_id: string | null; transfer_id: string | null; note: string | null; created_at: string
}

export interface CashBalances { cash: number; bank: number }

// Pure: fold rows into balances. Lives in src/lib/cashBalances.ts for unit tests.
export function computeBalances(rows: Pick<CashMovement,'account'|'direction'|'amount'>[]): CashBalances

export async function fetchMovements(opts?: { limit?: number }): Promise<CashMovement[]>
export async function fetchBalances(): Promise<CashBalances>          // sums all rows
export async function postMovement(m: Omit<CashMovement,'id'|'user_id'|'created_at'> & { created_at?: string }): Promise<CashMovement>
export async function deleteMovementsByRef(ref_table: string, ref_id: string): Promise<void>
export async function postTransfer(from: CashAccount, to: CashAccount, amount: number, note?: string): Promise<void> // two legs, shared transfer_id
```

`computeBalances` lives in `src/lib/cashBalances.ts` (pure, Supabase-free, unit
tested): `cash = Σ(cash in) − Σ(cash out)`, `bank = Σ(bank in) − Σ(bank out)`.

---

## 3. Posting rules (where each row is written)

| Event | Trigger site | Row(s) |
|-------|-------------|--------|
| Sale recorded | `store.addSaleBatch` (after `recordSaleBatch` success) | 1 IN, account by method; credit→deposit to cash |
| Sale deleted | `supabaseApi.deleteSaleGroup` (already cascades debts) | `deleteMovementsByRef('sales', sale_group_id)` |
| Debtor pays tab | `Debts.recordPayment` (type `owed`) | IN, account chosen on sheet (default cash), category `debtor_payment` |
| You pay a tab you owe | `Debts.recordPayment` (type `owing`) | OUT, account chosen, category `debt_repayment` |
| Expense added | `store.addExpense` | OUT, account chosen on form, category `expense`, ref `expenses` |
| Expense deleted | `store.removeExpense` | `deleteMovementsByRef('expenses', id)` |
| Loan repayment | `capitalApi.recordInstallmentPayment` (+ account arg) | OUT, account chosen, category `loan_repayment`, ref `capital_injections` |
| Stock received | `batchApi.receiveStock` (+ account/unpaid args) | OUT total_cost, account chosen, category `stock_purchase`, ref `stock_batches`; skipped if "unpaid" |
| Bank deposit/withdraw | Cash Flow page | `postTransfer` (two legs) |
| Adjustment / opening | Cash Flow page | single row, category `adjustment` |

**Payment add/edit/delete sync (v1 rule):**
- **Add payment** (record payment / mark paid) → post one movement: `debtor_payment`
  IN for `owed`, `debt_repayment` OUT for `owing`, amount = the payment, account
  = chosen on the sheet, `ref_table='debts'`, `ref_id=debtId`.
- **Delete a payment** → remove the most recent matching movement for that debt
  (`ref_id=debtId`) whose `amount` equals the deleted payment.
- **Edit a payment amount** → delete-then-add per the two rules above.
- Credit-sale deposits are posted as a `sale` row at sale time (not
  `debtor_payment`), so later tab payments never double-count.
Full historical re-sync of per-payment accounts is out of scope for v1 (see O1).

---

## 4. Dashboard / store integration

- `getDashboardSummary` returns `cashInHand` and **`cashInBank`** computed from
  `fetchBalances()` (replaces the `sales − expenses − unpaidCreditSales` formula).
  `creditSalesOutstanding` is retained for the Debts UI but no longer feeds cash.
- `store.AppState` gains `bankBalance`; `SET_BANK_BALANCE` action; all balance
  refresh sites set both `balance` (cash) and `bankBalance`.
- Offline fallback computes both from cached movements if present, else 0.

## 5. UI

- **Dashboard hero** (`Dashboard.tsx:62`): show **Cash in Hand** and **Cash in
  Bank** side by side (Odometer for hand; compact figure for bank).
- **New Cash Flow page** `src/pages/CashFlow.tsx` + route `/cash`, reached from a
  Dashboard quick-action tile:
  - Two balance cards (hand, bank).
  - Dated movement list: category label, note, account chip, signed amount
    (green in / red out).
  - Floating actions: **Deposit to bank**, **Withdraw to cash**, **Adjustment**
    (sheet with amount, account(s), note).
- **Account pickers** (cash/bank segmented control) added to: Expense form,
  loan repayment input (InjectionDetail), debt record-payment sheet (Debts),
  stock receive (AddProduct/restock) with an extra **"Unpaid (supplier credit)"**
  option.

## 6. Testing

- `src/lib/cashBalances.test.ts` (pure): empty→0/0; cash in/out; bank in/out;
  mixed; transfer nets to zero across accounts; adjustment.
- `src/lib/cashPosting.test.ts` (pure): a helper `movementForSale(group)` mapping
  payment_method→account and amount (cash/momo/bank full; credit→deposit). Test
  each method.
- Follow existing `src/lib/*.test.ts` vitest pattern. API/UI layers gate on
  tsc + eslint (zero new) + build + manual checks (repo has no API/UI unit tests).

## 7. Rollout

Apply `migration_019` (table + RLS + realtime + backfill) before the new build
relies on the ledger. Until applied, ledger reads return empty and balances show
0 — so ship the migration first, exactly as with 016–018.

## Open questions (resolved for v1)

- **O1 — per-payment account on edits:** v1 assumes debtor/`owing` payments post
  on each action and remove-by-ref on delete; full historical edit-resync with
  per-payment account is deferred (documented in §3). Acceptable because payment
  edits are rare and balances self-correct on the next fresh post.
- **O2 — momo vs bank distinction:** both map to the single `bank` account in v1
  (no separate MoMo balance). Revisit only if the owner asks.

## Phasing (plan will follow this order; each ships working software)

1. `migration_019` + `cashApi`/`cashBalances` + dashboard shows both balances (backfill makes them correct).
2. Auto-post sales (by method) + expenses, with delete-sync.
3. Account pickers on loan repayment, stock receive, debt payments; debtor-payment inflow.
4. Cash Flow page + bank transfers + adjustments.
