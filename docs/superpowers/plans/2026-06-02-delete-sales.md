# Delete Sales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user delete a Sales-History entry (single or grouped), removing it from the sales list/totals, dashboard, and reports, while restoring product stock and decrementing the customer's total.

**Architecture:** New `deleteSaleGroup` API (delete rows + restore stock + decrement customer), a `deleteSale` store action with a `DELETE_SALES` reducer case and dashboard refetch, and a trash button + confirm dialog in Sales History. Reads (Sales History stats, dashboard, reports) recompute from `state.sales`.

**Tech Stack:** React 19, TypeScript, Vite, Supabase JS, framer-motion, lucide-react.

**Testing note:** No unit-test runner (scripts: `dev`, `build`, `lint`, `preview`). Verification = `npm run build` + `npm run lint` + manual. Do not add a test framework.

---

### Task 1: `deleteSaleGroup` API

**Files:**
- Modify: `src/services/supabaseApi.ts` (add after `recordSaleBatch`, which ends ~line 175)

- [ ] **Step 1: Add the function**

Insert after the `recordSaleBatch` function's closing brace:

```ts
// Delete all sale rows of one Sales-History entry, restore the sold stock, and
// decrement the customer's lifetime total. Scoped to the current user.
export async function deleteSaleGroup(sales: Sale[]): Promise<void> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')
  if (sales.length === 0) return

  const ids = sales.map((s) => s.id)
  const { error: delError } = await supabase
    .from('sales')
    .delete()
    .in('id', ids)
    .eq('user_id', uid)
  if (delError) throw delError

  // Restore stock: sum the deleted quantity per product, add it back.
  const qtyByProduct = new Map<string, number>()
  for (const s of sales) {
    if (!s.product_id) continue
    qtyByProduct.set(s.product_id, (qtyByProduct.get(s.product_id) || 0) + s.quantity)
  }
  for (const [productId, qty] of qtyByProduct) {
    const { data: product } = await supabase
      .from('products')
      .select('quantity')
      .eq('id', productId)
      .eq('user_id', uid)
      .single()
    if (product) {
      await supabase
        .from('products')
        .update({ quantity: (product.quantity || 0) + qty })
        .eq('id', productId)
        .eq('user_id', uid)
    }
  }

  // Decrement the customer's lifetime total by the deleted sale total.
  const customerName = sales[0].customer_name
  if (customerName) {
    const groupTotal = sales.reduce((sum, s) => sum + (s.total || 0), 0)
    const { data: customers } = await supabase
      .from('customers')
      .select('id, total_purchases')
      .eq('user_id', uid)
      .ilike('name', customerName)
    const customer = customers?.[0]
    if (customer) {
      await supabase
        .from('customers')
        .update({ total_purchases: Math.max(0, (customer.total_purchases || 0) - groupTotal) })
        .eq('id', customer.id)
        .eq('user_id', uid)
    }
  }
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors (function exported, unused until Task 2 — fine).

- [ ] **Step 3: Commit**

```bash
git add src/services/supabaseApi.ts
git commit -m "feat: deleteSaleGroup API with stock restore and customer adjust"
```

---

### Task 2: `DELETE_SALES` reducer + `deleteSale` store action

**Files:**
- Modify: `src/lib/store.tsx` (import, action union ~line 66, reducer case ~line 142, context type ~line 196, impl after `addSaleBatch` ~line 468, provider value)

- [ ] **Step 1: Import `deleteSaleGroup`**

In the `@/services/supabaseApi` import block, add `deleteSaleGroup` to the
`fetchSales, recordSale, recordSaleBatch,` line:

```ts
  fetchSales, recordSale, recordSaleBatch, deleteSaleGroup,
```

Also ensure `SaleGroup` is importable: in the `import { ... } from './data'`
line (currently `import { loadData, saveData } from './data'`), add `type SaleGroup`:

```ts
import { loadData, saveData, type SaleGroup } from './data'
```

- [ ] **Step 2: Add the action to the union**

After the `| { type: 'ADD_SALE'; sale: Sale }` line:

```ts
  | { type: 'DELETE_SALES'; ids: string[] }
```

- [ ] **Step 3: Add the reducer case**

After the `case 'ADD_SALE':` line:

```ts
    case 'DELETE_SALES': return { ...state, sales: state.sales.filter((s) => !action.ids.includes(s.id)) }
```

- [ ] **Step 4: Add the context-type method**

After the `addSaleBatch: (...) => Promise<void>` line in `StoreContextType`:

```ts
  deleteSale: (group: SaleGroup) => Promise<void>
```

- [ ] **Step 5: Implement `deleteSale`**

Insert immediately after the `addSaleBatch` `useCallback` block (after its
`}, [state, showToast])`):

```ts
  const deleteSale = useCallback(async (group: SaleGroup) => {
    const ids = group.sales.map((s) => s.id)
    try {
      await deleteSaleGroup(group.sales)
      dispatch({ type: 'DELETE_SALES', ids })
      const products = await fetchProducts()
      dispatch({ type: 'SET_PRODUCTS', products })
      const summary = await getDashboardSummary()
      dispatch({ type: 'SET_BALANCE', value: summary.totalSales - summary.totalExpenses })
      dispatch({ type: 'SET_TODAY_SALES', value: summary.todaySales })
      dispatch({ type: 'SET_TODAY_PROFIT', value: summary.todayProfit })
      const customers = await fetchCustomers()
      dispatch({ type: 'SET_CUSTOMERS', customers })
      showToast('Sale deleted', 'success')
    } catch {
      // Offline / error fallback: reflect the delete locally.
      dispatch({ type: 'DELETE_SALES', ids })
      const qtyByProduct = new Map<string, number>()
      for (const s of group.sales) {
        if (!s.product_id) continue
        qtyByProduct.set(s.product_id, (qtyByProduct.get(s.product_id) || 0) + s.quantity)
      }
      qtyByProduct.forEach((qty, productId) => {
        const existing = state.products.find((p) => p.id === productId)
        if (existing) {
          dispatch({ type: 'UPDATE_PRODUCT', product: { ...existing, quantity: existing.quantity + qty } })
        }
      })
      const customerName = group.sales[0].customer_name
      if (customerName) {
        const existing = state.customers.find((c) => c.name.toLowerCase() === customerName.toLowerCase())
        if (existing) {
          dispatch({ type: 'UPDATE_CUSTOMER', customer: { ...existing, total_purchases: Math.max(0, (existing.total_purchases || 0) - group.total) } })
        }
      }
      showToast('Sale deleted (offline)', 'success')
    }
  }, [state, showToast])
```

- [ ] **Step 6: Expose in the provider value**

In the `<StoreContext.Provider value={{ ... }}>` object, add `deleteSale` next to
`addSaleBatch`:

```ts
      addSale, addSaleBatch, deleteSale, addDebt, updateDebt, addExpense, removeExpense,
```

- [ ] **Step 7: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors in `store.tsx`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/store.tsx
git commit -m "feat: deleteSale store action with DELETE_SALES reducer"
```

---

### Task 3: Trash button + confirm dialog in Sales History

**Files:**
- Modify: `src/pages/SalesHistory.tsx` (imports, state, grouped row, confirm dialog)

- [ ] **Step 1: Imports and store hook**

Change the lucide import (line 3) to add `Trash2` and `AlertTriangle`:

```tsx
import { X, Search, Receipt, User, Trash2, AlertTriangle } from 'lucide-react'
```

Add `deleteSale` and `SaleGroup` type: the file already imports
`groupSales, type SaleGroup` from `@/lib/data`. Change the store hook line
`const { state } = useStore()` to:

```tsx
  const { state, deleteSale } = useStore()
```

- [ ] **Step 2: Add delete state**

After the existing `const [showReceipt, setShowReceipt] = useState(false)` line:

```tsx
  const [confirmDelete, setConfirmDelete] = useState<SaleGroup | null>(null)
  const [deleting, setDeleting] = useState(false)
```

- [ ] **Step 3: Restructure the grouped row (clickable area + trash button)**

A `<button>` cannot nest inside a `<button>`, so split the row into a flex
container with a clickable info button and a separate trash button. Replace the
entire `{filteredGroups.map((group: SaleGroup, i) => { ... })}` block with:

```tsx
        {filteredGroups.map((group: SaleGroup, i) => {
          const head = group.sales[0]
          const lineCount = group.sales.length
          const title = lineCount > 1 ? `${head.product_name} +${lineCount - 1} more` : head.product_name
          return (
            <motion.div
              key={group.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="w-full bg-light harsh-border rounded-sm flex items-center gap-2 pr-2"
            >
              <button
                onClick={() => { setSelectedSales(group.sales); setShowReceipt(true) }}
                className="flex-1 min-w-0 p-3 flex items-center gap-3 text-left"
              >
                <div className="w-10 h-10 bg-warm-gray rounded-sm flex items-center justify-center flex-shrink-0">
                  <ProductIcon
                    category={state.products.find((p) => p.id === head.product_id)?.category || 'default'}
                    size={22}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-text">{formatDate(group.created_at)} {formatTime(group.created_at)}</span>
                    {group.customer_name && (
                      <span className="text-[10px] text-accent-green flex items-center gap-0.5">
                        <User size={8} /> {group.customer_name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-display text-sm text-ink">{formatCurrency(group.total)}</p>
                  {lineCount > 1 ? (
                    <p className="text-[9px] text-muted-text">{group.itemCount} items</p>
                  ) : (
                    <p className="text-[9px] text-muted-text">{head.quantity} x {formatCurrency(head.unit_price)}</p>
                  )}
                </div>
              </button>
              <button
                onClick={() => setConfirmDelete(group)}
                aria-label="Delete sale"
                className="btn-tactile w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-sm"
              >
                <Trash2 size={18} className="text-accent-red" />
              </button>
            </motion.div>
          )
        })}
```

- [ ] **Step 4: Add the confirm dialog**

Immediately before the existing `<ReceiptModal ... />` near the end of the
component, add:

```tsx
      {confirmDelete && (
        <>
          <div className="fixed inset-0 bg-black/50 z-[60]" onClick={() => !deleting && setConfirmDelete(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-sand harsh-border rounded-sm z-[61] w-[85vw] max-w-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-accent-red" />
              <h3 className="font-display text-lg text-ink uppercase tracking-tight">Delete sale?</h3>
            </div>
            <p className="text-sm text-muted-text mb-1">
              {confirmDelete.sales[0].product_name}
              {confirmDelete.sales.length > 1 ? ` +${confirmDelete.sales.length - 1} more` : ''} · {formatCurrency(confirmDelete.total)}
            </p>
            <p className="text-xs text-muted-text mb-5">Stock will be restored. This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="flex-1 h-12 bg-warm-gray rounded-sm font-display text-sm text-ink uppercase tracking-wider disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDeleting(true)
                  try { await deleteSale(confirmDelete) } finally { setDeleting(false); setConfirmDelete(null) }
                }}
                disabled={deleting}
                className="flex-1 h-12 bg-accent-red rounded-sm font-display text-sm text-white uppercase tracking-wider disabled:opacity-50"
              >
                {deleting ? '...' : 'Delete'}
              </button>
            </div>
          </div>
        </>
      )}
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors in `SalesHistory.tsx` (all of `Trash2`,
`AlertTriangle`, `deleteSale`, `confirmDelete`, `deleting` are used).

- [ ] **Step 6: Commit**

```bash
git add src/pages/SalesHistory.tsx
git commit -m "feat: delete sale with confirm dialog in Sales History"
```

---

### Task 4: Manual verification

**Files:** none.

- [ ] **Step 1:** `npm run dev` → Sales History → tap trash on a single-product
  sale → confirm → row gone; Sales count −1; Revenue/Profit drop by its amount.
- [ ] **Step 2:** Open Inventory → that product's stock increased by the sold qty.
- [ ] **Step 3:** Dashboard → today's sales / balance reflect the removal; Latest
  Sales no longer lists it.
- [ ] **Step 4:** Delete a grouped (multi-item) sale → all line items removed in
  one action; each product's stock restored; customer's total reduced by the
  grouped total.
- [ ] **Step 5:** Tapping the row body (not the trash) still opens the receipt;
  Cancel in the dialog changes nothing.
- [ ] **Step 6:** Reports period totals reflect the deletion.
- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: verify delete sales" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- `deleteSaleGroup` (delete rows, restore stock per product, decrement customer) → Task 1 ✓
- `DELETE_SALES` reducer + `deleteSale` store action + dashboard/customers refetch + offline fallback → Task 2 ✓
- Trash button per row + confirm dialog → Task 3 ✓
- Propagation: Sales History stats, dashboard, reports recompute from `state.sales`/summary; stock + customer adjusted → Tasks 1–2, verified Task 4 ✓
- Grouped vs single via `group.sales` → Tasks 1–3 ✓

**Placeholder scan:** none — full code for every step; exact anchors; explicit expected outputs.

**Type consistency:** `deleteSaleGroup(sales: Sale[])` defined Task 1, called Task 2. `deleteSale(group: SaleGroup)` defined Task 2 (type + impl + provider), consumed Task 3 (`deleteSale(confirmDelete)` where `confirmDelete: SaleGroup`). `DELETE_SALES { ids: string[] }` union/case/dispatch consistent. `SaleGroup` fields used (`sales`, `total`, `created_at`, `customer_name`, `itemCount`) match the existing `data.ts` definition. Reused actions (`SET_PRODUCTS`, `UPDATE_PRODUCT`, `SET_BALANCE`, `SET_TODAY_SALES`, `SET_TODAY_PROFIT`, `SET_CUSTOMERS`, `UPDATE_CUSTOMER`) and `fetchCustomers`/`fetchProducts`/`getDashboardSummary` are all pre-existing.
