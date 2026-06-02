# Delete Sales (with full propagation) — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Problem

There is no way to delete a recorded sale. Sales History lists entries but
offers no delete. The user wants to delete a sale and have it removed from every
area it affects: the sales list and its totals, the dashboard, reports, product
stock, and the customer's lifetime total.

## Goals

- Delete a Sales-History entry (which may be a grouped multi-product sale).
- Restore the sold quantity back to product stock.
- Decrement the customer's `total_purchases` by the deleted sale's total.
- Sales list, Sales-History stat cards, dashboard today/balance, and reports all
  reflect the deletion immediately.
- Guard the destructive action with a confirmation.

## Non-Goals

- No undo/restore of a deleted sale.
- No partial deletion of a single line within a grouped sale (the whole grouped
  entry is deleted).
- No change to recording/checkout.

## Current State (verified)

- No `DELETE_SALE*` reducer case, no `deleteSale` store method, no
  `deleteSaleDb` API function exist.
- `getDashboardSummary()` recomputes totals from the DB sales table; Sales
  History and Reports derive their numbers from `state.sales`. So once rows are
  removed from the DB and `state.sales`, those areas self-correct (plus a summary
  refetch for the dashboard cards/balance).
- Sales-History rows render from `groupSales(filteredSales)`; each `SaleGroup`
  carries `sales: Sale[]`, `total`, `customer_name`, etc.

## Design

### 1. API — `deleteSaleGroup(sales: Sale[]): Promise<void>` (`src/services/supabaseApi.ts`)

Operate on the line rows of one Sales-History entry:
- Resolve `uid`; throw `Not authenticated` if missing (same as other writers).
- **Delete rows:** `supabase.from('sales').delete().in('id', sales.map(s => s.id)).eq('user_id', uid)`.
- **Restore stock:** aggregate quantity per `product_id` across `sales`
  (skip null `product_id`). For each, read the product's current `quantity`
  (scoped by id + uid) and update `quantity = current + qtyForThatProduct`.
- **Decrement customer:** take `customer_name` from `sales[0]`; if set, find the
  customer row (case-insensitive name match, scoped to uid) and update
  `total_purchases = max(0, current - groupTotal)` where
  `groupTotal = sum(s.total)`.

All DB ops scoped to `user_id`. Order: delete sales, then restore stock, then
adjust customer.

### 2. Store — `deleteSale(group: SaleGroup)` + reducer (`src/lib/store.tsx`)

Add reducer action and case:
```ts
| { type: 'DELETE_SALES'; ids: string[] }
// ...
case 'DELETE_SALES':
  return { ...state, sales: state.sales.filter((s) => !action.ids.includes(s.id)) }
```

Add context method `deleteSale: (group: SaleGroup) => Promise<void>` and impl:
- `const ids = group.sales.map((s) => s.id)`
- Online:
  - `await deleteSaleGroup(group.sales)`
  - `dispatch({ type: 'DELETE_SALES', ids })`
  - `const products = await fetchProducts(); dispatch({ type: 'SET_PRODUCTS', products })`
  - `const summary = await getDashboardSummary();` dispatch `SET_BALANCE`
    (`totalSales - totalExpenses`), `SET_TODAY_SALES`, `SET_TODAY_PROFIT`
    (mirrors `addSaleBatch`).
  - `const customers = await fetchCustomers(); dispatch({ type: 'SET_CUSTOMERS', customers })`
    (reflect the decremented total).
  - `showToast('Sale deleted', 'success')`
- Offline / error fallback:
  - `dispatch({ type: 'DELETE_SALES', ids })`
  - Restore stock in state: aggregate qty per product, for each existing product
    `dispatch UPDATE_PRODUCT` with `quantity + qty`.
  - Decrement the customer in state if found (`UPDATE_CUSTOMER`-style dispatch or
    the existing customer-update reducer).
  - `showToast('Sale deleted (offline)', 'success')`

Import `deleteSaleGroup` from `@/services/supabaseApi` and the `SaleGroup` type
from `@/lib/data`. `fetchCustomers` is already imported. Expose `deleteSale` in
the provider value.

Confirmed existing actions to reuse: `SET_CUSTOMERS { customers }`,
`UPDATE_CUSTOMER { customer }` (takes a full `Customer`), `SET_PRODUCTS`,
`UPDATE_PRODUCT`, `SET_BALANCE`, `SET_TODAY_SALES`, `SET_TODAY_PROFIT`.

### 3. UI — trash button + confirm dialog (`src/pages/SalesHistory.tsx`)

- Pull `deleteSale` from `useStore()`.
- Each grouped row: add a trash icon button on the right. Its `onClick` calls
  `e.stopPropagation()` then opens a confirm dialog for that group (the row's
  main click still opens the receipt).
- Confirm dialog (same modal pattern as Settings' reset/logout dialogs):
  - Title: "Delete sale?"
  - Body: "<first product name> (+N more if grouped) · <formatted total>. Stock
    will be restored." 
  - Buttons: Cancel / Delete (Delete in accent-red).
  - On Delete: `await deleteSale(group)`, close dialog. A `deleting` flag
    disables the button while in flight.
- State: `const [confirmDelete, setConfirmDelete] = useState<SaleGroup | null>(null)`
  and `const [deleting, setDeleting] = useState(false)`.

### 4. Propagation summary

| Area | How it updates |
|------|----------------|
| Sales History list + Sales/Revenue/Profit cards | recompute from `state.sales` → `filteredSales`/`filteredGroups` |
| Dashboard Latest Sales | `state.sales` (grouped) |
| Dashboard today sales / profit / balance | `getDashboardSummary` refetch dispatched |
| Reports | reads `state.sales` |
| Product stock | restored per line in `deleteSaleGroup` + state |
| Customer total_purchases | decremented in `deleteSaleGroup` + `fetchCustomers` refetch |

### 5. Grouped vs single

A grouped entry (shared `sale_group_id`) deletes all its rows
(`group.sales`). A legacy single sale (null group) is a one-row group → deletes
that row. No special-casing needed; both flow through `group.sales`.

## No-Break Guarantees

- Additive: new API fn, new reducer case, new store method, new UI. Recording,
  checkout, scanning, and existing reads are untouched.
- All DB ops scoped to `user_id`.
- Confirmation dialog guards the irreversible delete.

## Testing / Verification

No unit-test runner; verification = `npm run build` + `npm run lint` + manual:

- Delete a single-product sale → row gone; Sales count −1; Revenue/Profit drop by
  its amount; product stock increased by its qty; dashboard today/balance update.
- Delete a grouped (multi-item) sale → all its line items gone in one action;
  totals and each product's stock adjust for every line; customer total drops by
  the grouped total.
- Cancel in the confirm dialog → nothing changes.
- Reports period totals reflect the deletion.
- Offline (or DB error) → row still disappears locally, stock restored in state,
  toast indicates offline.
