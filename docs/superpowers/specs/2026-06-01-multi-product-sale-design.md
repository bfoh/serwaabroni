# Multi-Product Sale — Design Spec

**Date:** 2026-06-01
**Status:** Approved
**Component:** `src/components/AddSaleSheet.tsx` + store + API layer

## Problem

The New Sale flow (`AddSaleSheet`) records exactly one product per sale: a
single `selectedProduct` + `quantity`, one payment method, one optional
customer. A shopkeeper selling several different items in one transaction must
repeat the whole flow per product. Expand it to support a cart of multiple
products in a single checkout.

## Goals

- Add multiple distinct products to one sale, each with its own quantity.
- One shared payment method and one shared customer for the whole basket.
- Block overselling (cap each line at available stock).
- Break nothing: reports, dashboard, stock decrement, debts, profit math, and
  existing callers all keep working unchanged.

## Non-Goals

- No new `orders` / `order_items` tables. No DB migration.
- No per-line payment method or per-line customer.
- No backorder / negative stock.
- No change to the `Sale` type or `sales` table schema.

## Chosen Approach: multiple sale rows

On confirm, the cart writes **one `sales` row per product**, all sharing the
same `customer_name`, `customer_phone`, `payment_method`, and `created_at`.

Rationale: the `sales` table already stores one row per product line. Every
report and dashboard query sums per row (`getTodaySales`, `getProfitForPeriod`,
`getDashboardSummary`, etc.). Emitting N rows for an N-product cart keeps all of
that correct with zero schema or query changes. Rejected alternative — new
`orders`/`order_items` tables — would force a migration plus a rewrite of every
aggregation query, with high risk of breaking working parts.

## Data Model

No schema change. `Sale` (in `src/lib/supabase.ts`) is unchanged.

### Cart state (component-local, in `AddSaleSheet`)

```ts
type CartItem = {
  product_id: string
  name: string
  category: string
  unit_price: number   // product.selling_price at add time
  cost_price: number   // product.cost_price at add time (for profit)
  quantity: number
  stock: number        // product.quantity snapshot, for the qty cap
}
```

Shared across the whole cart:
- `paymentMethod: 'cash' | 'momo' | 'bank'`
- `customerName: string`
- `customerPhone: string`

Derived:
- `total = sum(item.unit_price * item.quantity)`
- `profit = sum((item.unit_price - item.cost_price) * item.quantity)`
- `itemCount = sum(item.quantity)`

## UX Flow

1. **Product grid** (unchanged search + grid). Tapping a product **adds it to
   the cart** at quantity 1 (instead of navigating to a single-product screen).
   Tapping a product already in the cart increments its existing line — no
   duplicate rows.
2. **Cart view** (replaces the single selected-product screen):
   - List of cart lines. Each line: product name, unit price, `− qty +`
     stepper, line subtotal, and a remove (×) button.
   - `+` is capped at the line's `stock` snapshot (`Math.min(stock, qty+1)`),
     `−` floors at 1; remove deletes the line.
   - "Add more products" button returns to the grid.
   - Shared payment method selector (cash/momo/bank) — unchanged UI.
   - Shared optional customer form (name/phone/saved-customer select) —
     unchanged UI.
   - Total panel shows grand total + grand profit.
3. **Confirm:** `CONFIRM SALE` disabled when cart is empty or saving. On click,
   writes the whole cart via `addSaleBatch`.
4. **Success screen:** "Sale Recorded!" shows grand total and item count (e.g.
   "3 items"). If a phone was given, one SMS receipt for the whole basket.

## Store Layer (`src/lib/store.tsx`)

Keep `addSale` exactly as-is (other callers and the offline path stay valid).
Add a new context method:

```ts
addSaleBatch: (
  sales: Omit<Sale, 'user_id'>[],
  items: { productId: string; qty: number }[]
) => Promise<void>
```

Behavior:
- Online: call `recordSaleBatch(sales, items)` once; dispatch each returned row
  via `ADD_SALE` (or a batched insert); then a **single** refresh —
  `fetchProducts` → `SET_PRODUCTS`, `getDashboardSummary` →
  balance/today-sales/today-profit. One round-trip of refresh work for the
  whole cart, not N.
- Offline / error fallback: push every row as `user_id: 'local'` via `ADD_SALE`;
  for each item, `UPDATE_PRODUCT` with `quantity = max(0, current - qty)`.
  Mirrors the existing single-sale offline fallback.

The existing `ADD_SALE` reducer case is reused (called once per row).

## API Layer (`src/services/supabaseApi.ts`)

Keep `recordSale` as-is. Add:

```ts
export async function recordSaleBatch(
  sales: Omit<Sale, 'user_id'>[],
  items: { productId: string; qty: number }[]
): Promise<Sale[]>
```

Behavior:
- Resolve `uid` (throw `Not authenticated` if missing — same as `recordSale`).
- Bulk-insert all rows: `.from('sales').insert(sales.map(s => ({...s, user_id})))
  .select()`.
- Decrement stock per item (same read-then-update pattern as `recordSale`,
  scoped by `id` + `user_id`), looped over `items`.
- Return inserted rows.

## Customer Aggregation

One customer per cart. On confirm, if a customer name is present:
- Existing customer: `total_purchases += grandTotal` (cart total, not per item),
  update phone if provided.
- New customer: insert with `total_purchases = grandTotal`.

Same fire-and-forget pattern as today (`.catch(() => {})`, non-blocking).

## Receipt

One SMS receipt per cart (whole basket), sent when a phone number is provided.
Success screen reflects grand total + item count.

## No-Break Guarantees

- `sales` table + `Sale` type unchanged → Report, Debts, Dashboard untouched.
- `addSale` (store) and `recordSale` (API) kept; only additive new functions.
- Each cart line persists as a normal sale row → per-product analytics stay
  correct.
- Stock cap reuses the existing `Math.min(stock, ...)` rule.
- Offline fallback path preserved (batched).

## Testing / Verification

- TypeScript build passes (`npm run build`).
- Manual: add 2–3 products, vary quantities, confirm; verify N sale rows,
  stock decremented per product, dashboard totals increase by grand total,
  customer `total_purchases` increased by grand total once.
- Single-product cart still behaves like the old flow (regression).
- Empty cart → confirm disabled.
- Qty cannot exceed stock per line.
