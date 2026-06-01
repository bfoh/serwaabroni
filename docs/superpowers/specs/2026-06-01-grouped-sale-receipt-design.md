# Grouped Multi-Item Sale + Single Receipt — Design Spec

**Date:** 2026-06-01
**Status:** Approved
**Depends on:** `2026-06-01-multi-product-sale-design.md` (cart writes one `sales`
row per product via `addSaleBatch` / `recordSaleBatch`).

## Problem

A multi-product cart currently persists as N independent `sales` rows. The
Latest Sales list (Dashboard) and Sales History show each row separately, and
tapping a row opens a single-item receipt. The shopkeeper wants one cart to
appear as **one entry** listing the products purchased, with **one
invoice/receipt** covering the whole basket.

## Goals

- A cart shows as a single grouped entry in Latest Sales and Sales History.
- Tapping the entry opens one receipt listing every product + grand total.
- Existing single-product sales (already in the DB) render exactly as today.
- Reports/dashboard money stats stay correct (still sum per-row).

## Non-Goals

- No `orders`/`order_items` tables. Sales rows stay the unit of record.
- No backfill of historical rows (old rows have a null group → render solo).
- No change to how stock is decremented or how money totals are computed.

## Chosen Approach: `sale_group_id` column

Add a nullable `sale_group_id UUID` to `sales`. At checkout, `AddSaleSheet`
generates one id per cart and stamps it on every row. Display layers group rows
by this id. Rows with a null id are singleton groups (old data + the legacy
single-sale path).

Rationale: grouping by a dedicated id is robust — no false merges. Grouping by
`created_at` + customer was rejected: two separate single-item sales at the same
second by the same customer would wrongly merge. The column is nullable and
additive, so it is backward compatible and needs no data migration.

## Data Model

### Schema change (run once in Supabase SQL editor)

```sql
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_sales_group ON sales(sale_group_id);
```

Also add the column to `src/db/schema.sql` (sales table) for parity.

### Type change (`src/lib/supabase.ts`)

Add to `interface Sale`:
```ts
  sale_group_id?: string | null
```

## Write Path

`AddSaleSheet.handleConfirm` (already builds the `sales` array):
- Generate `const groupId = uid()` once.
- Add `sale_group_id: groupId` to every row object in the `sales` array.

`recordSaleBatch` already inserts `{ ...s, user_id }` for each row, so the field
flows through with no change. The legacy `recordSale` (single) path is untouched
and leaves the column null. A one-item cart still gets a group id and renders as
a group of one (identical to a solo row visually).

## Grouping Helper (`src/lib/data.ts`)

Pure function, no React, independently testable:

```ts
import type { Sale } from './supabase'

export interface SaleGroup {
  key: string                 // sale_group_id, or the row id for ungrouped
  sales: Sale[]               // line items, input order preserved
  total: number               // sum of line totals
  profit: number              // sum of line profits
  itemCount: number           // sum of quantities
  created_at: string          // from the first row
  customer_name: string | null
  customer_phone: string | null
  payment_method: 'cash' | 'momo' | 'bank'
}

export function groupSales(sales: Sale[]): SaleGroup[]
```

Behavior:
- Iterate `sales` in input order (callers pass newest-first, as the DB returns).
- Rows with a truthy `sale_group_id` accumulate into one `SaleGroup` keyed by
  that id; the group keeps its first-seen position in the output.
- Rows with a null/undefined `sale_group_id` each become their own singleton
  group keyed by the row `id`.
- Aggregate `total`, `profit`, `itemCount`; take `created_at`, customer fields,
  and `payment_method` from the first row in the group.

## Render Changes

### Dashboard (`src/pages/Dashboard.tsx`)

- Replace `recentSales = state.sales.slice(0, 6)` with
  `recentGroups = groupSales(state.sales).slice(0, 6)` — slice **groups**, so a
  cart is never cut mid-way.
- Each entry renders one button:
  - Icon: category of the first line item.
  - Title: if `itemCount`/lines === 1, the product name (as today); if multiple
    lines, `"<first product> +N more"` where `N = sales.length - 1`.
  - Subtitle: date/time + optional customer name (unchanged).
  - Right: `+<grand total>`; secondary line `"<lineCount> items"` when the group
    has more than one line (replaces the current `qty x unit_price` line, which
    only made sense for one product).
- `onClick` opens the receipt with the group's `sales` array.
- `receiptSale: Sale | null` state becomes `receiptSales: Sale[]`.

### Sales History (`src/pages/SalesHistory.tsx`)

- After `filteredSales` is computed, derive `filteredGroups =
  groupSales(filteredSales)` and map over groups instead of rows. Same row
  layout rules as Dashboard.
- Stats: revenue/profit still sum `filteredSales` rows (unchanged). The
  transactions **count** becomes `filteredGroups.length` (number of receipts),
  which is the meaningful "how many sales" number once carts are grouped.
- `onClick` opens the receipt with the group's `sales`.

## ReceiptModal (`src/components/ReceiptModal.tsx`)

Change the interface from a single sale to a list:

```ts
interface ReceiptModalProps {
  sales: Sale[]          // one or more line items of a single sale/cart
  isOpen: boolean
  onClose: () => void
}
```

- Guard: `if (!isOpen || sales.length === 0) return null`.
- Derive a `head = sales[0]` for shared fields (date, customer, payment) and:
  - `grandTotal = sum(s.total)`, `itemCount = sum(s.quantity)`.
  - `receiptNo` built from `head.sale_group_id ?? head.id` (last 4 chars), so a
    grouped cart shares one number.
- Items section renders **one line per `sales[]` entry**: product name,
  `qty x unit_price`, line total.
- Total block shows `grandTotal`.
- `receiptText` (WhatsApp/SMS), the `<canvas>` image, and the print view all
  loop the line items and show the grand total (today they hard-code the single
  product — replace with a loop).
- Both callers updated to pass `sales={group.sales}`.

## No-Break Guarantees

- Money stats (today sales, today profit, totals, charts) keep summing the flat
  `state.sales` rows — untouched.
- Null-`sale_group_id` rows (all existing data, and any legacy single-sale
  inserts) render as singleton groups → visually identical to today.
- `addSaleBatch` / `recordSaleBatch` signatures unchanged; rows simply carry one
  extra optional field.
- `groupSales` is additive and pure; no existing function is modified beyond the
  two render files and ReceiptModal.

## Testing / Verification

Project has no unit-test runner; verification = `npm run build` + `npm run lint`
+ manual:

- **Multi-item:** sell 2–3 products in one cart → Latest Sales shows ONE entry
  ("<product> +N more", grand total, "N items"). Tap → receipt lists every
  product with its qty×price and a correct grand total. WhatsApp/SMS/Save/Print
  all show all line items.
- **Single-item regression:** a one-product sale shows one entry as before;
  receipt shows the one item.
- **Old data:** previously recorded single sales still render individually with
  working single-item receipts.
- **Stats:** dashboard today-sales / Sales-History revenue unchanged by grouping
  (still sum rows); Sales-History count shows number of receipts (groups).
