# Multi-Product Sale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one New Sale checkout record multiple distinct products (a cart), persisting one `sales` row per product with shared payment method and customer.

**Architecture:** Cart of line items in `AddSaleSheet`. On confirm, a new `addSaleBatch` store method calls a new `recordSaleBatch` API function that bulk-inserts the rows and decrements stock per product, then refreshes once. No schema change; the `sales` table and `Sale` type are untouched, so all reports/dashboard/stock logic keep working.

**Tech Stack:** React 19, TypeScript, Vite, Supabase JS, framer-motion, lucide-react, Tailwind.

**Note on testing:** This project has no unit-test runner (package.json scripts: `dev`, `build`, `lint`, `preview`). Verification per task = `npm run build` (tsc + vite build) and `npm run lint`, plus manual checks in the final task. Do not add a test framework — out of scope.

---

### Task 1: Add `recordSaleBatch` to the API layer

**Files:**
- Modify: `src/services/supabaseApi.ts` (add new function after `recordSale`, which ends ~line 131)

- [ ] **Step 1: Add the bulk-insert + stock-decrement function**

Insert this immediately after the existing `recordSale` function (after its closing `}` and before the `// ===== DEBTS` comment block):

```ts
// Record several sale rows in one checkout (a multi-product cart).
// Inserts all rows sharing the caller-provided customer/payment/timestamp,
// then decrements stock per product. Returns the inserted rows.
export async function recordSaleBatch(
  sales: Omit<Sale, 'user_id'>[],
  items: { productId: string; qty: number }[]
): Promise<Sale[]> {
  const uid = await getCurrentUserId()
  if (!uid) throw new Error('Not authenticated')

  // Insert all sale rows scoped to user
  const { data: saleData, error: saleError } = await supabase
    .from('sales')
    .insert(sales.map((s) => ({ ...s, user_id: uid })))
    .select()

  if (saleError) throw saleError

  // Reduce stock per product — scoped to user's own products
  for (const { productId, qty } of items) {
    if (!productId) continue
    const { data: product } = await supabase
      .from('products')
      .select('quantity')
      .eq('id', productId)
      .eq('user_id', uid)
      .single()

    if (product) {
      const newQty = Math.max(0, (product.quantity || 0) - qty)
      await supabase
        .from('products')
        .update({ quantity: newQty })
        .eq('id', productId)
        .eq('user_id', uid)
    }
  }

  return (saleData as Sale[]) || []
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS, no type errors. (`recordSaleBatch` is exported but not yet used — that's fine; it's a top-level export so no unused-var error.)

- [ ] **Step 3: Commit**

```bash
git add src/services/supabaseApi.ts
git commit -m "feat: add recordSaleBatch for multi-product checkout"
```

---

### Task 2: Add `addSaleBatch` to the store

**Files:**
- Modify: `src/lib/store.tsx` — import (line ~12), context type (~line 195), implementation (after `addSale`, ~line 437), provider value (~line 551)

- [ ] **Step 1: Import the new API function**

In the import block from `@/services/supabaseApi` (currently `fetchSales, recordSale,`), change that line to:

```ts
  fetchSales, recordSale, recordSaleBatch,
```

- [ ] **Step 2: Add the method to `StoreContextType`**

Directly below the existing `addSale` line in the interface:

```ts
  addSale: (sale: Omit<Sale, 'user_id'>, productId: string, quantitySold: number) => Promise<void>
  addSaleBatch: (sales: Omit<Sale, 'user_id'>[], items: { productId: string; qty: number }[]) => Promise<void>
```

- [ ] **Step 3: Implement `addSaleBatch`**

Insert immediately after the existing `addSale` `useCallback` block (after its closing `}, [state, showToast])`):

```ts
  const addSaleBatch = useCallback(async (
    sales: Omit<Sale, 'user_id'>[],
    items: { productId: string; qty: number }[]
  ) => {
    try {
      const recorded = await recordSaleBatch(sales, items)
      recorded.forEach((sale) => dispatch({ type: 'ADD_SALE', sale }))
      const products = await fetchProducts()
      dispatch({ type: 'SET_PRODUCTS', products })
      const summary = await getDashboardSummary()
      dispatch({ type: 'SET_BALANCE', value: summary.totalSales - summary.totalExpenses })
      dispatch({ type: 'SET_TODAY_SALES', value: summary.todaySales })
      dispatch({ type: 'SET_TODAY_PROFIT', value: summary.todayProfit })
      showToast('Sale recorded!', 'success')
    } catch {
      sales.forEach((sale) => {
        const localSale: Sale = { ...sale, user_id: 'local' } as Sale
        dispatch({ type: 'ADD_SALE', sale: localSale })
      })
      items.forEach(({ productId, qty }) => {
        const existing = state.products.find((p) => p.id === productId)
        if (existing) {
          dispatch({ type: 'UPDATE_PRODUCT', product: { ...existing, quantity: Math.max(0, existing.quantity - qty) } })
        }
      })
      showToast('Sale saved locally', 'success')
    }
  }, [state, showToast])
```

- [ ] **Step 4: Expose it in the provider value**

In the `<StoreContext.Provider value={{ ... }}>` object, change the line
`addSale, addDebt, updateDebt, addExpense, removeExpense,` to:

```ts
      addSale, addSaleBatch, addDebt, updateDebt, addExpense, removeExpense,
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store.tsx
git commit -m "feat: add addSaleBatch store action"
```

---

### Task 3: Convert `AddSaleSheet` to a multi-product cart

**Files:**
- Modify: `src/components/AddSaleSheet.tsx` (full rewrite of state + handlers + body)

This task replaces the single-product state with a cart. Replace the **entire file** with the content below.

- [ ] **Step 1: Replace the whole file**

```tsx
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Minus, Plus, Check, User, Phone, Trash2, ArrowLeft } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatCurrency, uid } from '@/lib/data'
import ProductIcon from './ProductIcon'

type CartItem = {
  product_id: string
  name: string
  category: string
  unit_price: number
  cost_price: number
  quantity: number
  stock: number
}

export default function AddSaleSheet() {
  const { state, dispatch, showToast, addSaleBatch, updateCustomer, addCustomer } = useStore()
  const [cart, setCart] = useState<CartItem[]>([])
  const [view, setView] = useState<'grid' | 'cart'>('grid')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo' | 'bank'>('cash')
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const total = useMemo(
    () => cart.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    [cart]
  )
  const profit = useMemo(
    () => cart.reduce((sum, i) => sum + (i.unit_price - i.cost_price) * i.quantity, 0),
    [cart]
  )
  const itemCount = useMemo(
    () => cart.reduce((sum, i) => sum + i.quantity, 0),
    [cart]
  )

  const filteredProducts = useMemo(() => {
    let list = state.products
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q))
    }
    return list.slice(0, 20)
  }, [state.products, searchQuery])

  const handleClose = () => {
    dispatch({ type: 'TOGGLE_ADD_SHEET', show: false })
    setCart([])
    setView('grid')
    setCustomerName('')
    setCustomerPhone('')
    setShowCustomerForm(false)
    setConfirmed(false)
    setSearchQuery('')
    setPaymentMethod('cash')
  }

  // Add a product to the cart (or increment if already present), capped at stock.
  const addToCart = (productId: string) => {
    const p = state.products.find((x) => x.id === productId)
    if (!p) return
    setCart((prev) => {
      const existing = prev.find((i) => i.product_id === productId)
      if (existing) {
        return prev.map((i) =>
          i.product_id === productId
            ? { ...i, quantity: Math.min(i.stock, i.quantity + 1) }
            : i
        )
      }
      return [
        ...prev,
        {
          product_id: p.id,
          name: p.name,
          category: p.category,
          unit_price: p.selling_price,
          cost_price: p.cost_price,
          quantity: Math.min(1, p.quantity),
          stock: p.quantity,
        },
      ]
    })
    setView('cart')
  }

  const changeQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev.map((i) =>
        i.product_id === productId
          ? { ...i, quantity: Math.max(1, Math.min(i.stock, i.quantity + delta)) }
          : i
      )
    )
  }

  const removeFromCart = (productId: string) => {
    setCart((prev) => {
      const next = prev.filter((i) => i.product_id !== productId)
      if (next.length === 0) setView('grid')
      return next
    })
  }

  const handleConfirm = async () => {
    if (cart.length === 0) return
    setSaving(true)
    try {
      const createdAt = new Date().toISOString()
      const sales = cart.map((i) => ({
        id: uid(),
        product_id: i.product_id,
        product_name: i.name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total: i.unit_price * i.quantity,
        profit: (i.unit_price - i.cost_price) * i.quantity,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        payment_method: paymentMethod,
        created_at: createdAt,
      }))
      const items = cart.map((i) => ({ productId: i.product_id, qty: i.quantity }))

      await addSaleBatch(sales, items)

      if (customerName) {
        const existingCustomer = state.customers.find(
          (c) => c.name.toLowerCase() === customerName.trim().toLowerCase()
        )
        if (existingCustomer) {
          updateCustomer(existingCustomer.id, {
            total_purchases: (existingCustomer.total_purchases || 0) + total,
            phone: customerPhone || existingCustomer.phone,
          }).catch(() => {})
        } else {
          addCustomer({
            id: uid(),
            name: customerName.trim(),
            phone: customerPhone || null,
            email: null,
            total_purchases: total,
            created_at: new Date().toISOString(),
          }).catch(() => {})
        }
      }

      setConfirmed(true)
      setTimeout(() => {
        handleClose()
      }, 1200)
    } catch {
      showToast('Failed to record sale', 'error')
    } finally {
      setSaving(false)
    }
  }

  const paymentOptions: { key: 'cash' | 'momo' | 'bank'; label: string }[] = [
    { key: 'cash', label: 'CASH' },
    { key: 'momo', label: 'MOMO' },
    { key: 'bank', label: 'BANK' },
  ]

  return (
    <AnimatePresence>
      {state.showAddSheet && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-50"
            onClick={handleClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 bg-sand rounded-t-2xl z-50 shadow-sheet"
            style={{ maxHeight: '90dvh' }}
          >
            {confirmed ? (
              <div className="flex flex-col items-center justify-center py-20 px-6">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 12 }}
                  className="w-20 h-20 rounded-full bg-accent-green flex items-center justify-center mb-6"
                >
                  <Check size={40} strokeWidth={3} className="text-white" />
                </motion.div>
                <p className="font-display text-2xl text-ink uppercase tracking-wide">Sale Recorded!</p>
                <p className="text-muted-text mt-2">
                  {formatCurrency(total)} · {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </p>
                {customerPhone && <p className="text-xs text-accent-green mt-1">Receipt sent via SMS</p>}
              </div>
            ) : (
              <div className="flex flex-col h-full" style={{ maxHeight: '92dvh' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b-2 border-ink flex-shrink-0">
                  <div className="flex items-center gap-3">
                    {view === 'grid' && cart.length > 0 && (
                      <button
                        onClick={() => setView('cart')}
                        className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray"
                      >
                        <ArrowLeft size={20} strokeWidth={2.5} className="text-ink" />
                      </button>
                    )}
                    <h2 className="font-display text-2xl text-ink uppercase tracking-tight">
                      {view === 'grid' ? 'Add Product' : 'New Sale'}
                    </h2>
                  </div>
                  <button onClick={handleClose} className="btn-tactile w-10 h-10 flex items-center justify-center rounded-sm bg-warm-gray">
                    <X size={20} strokeWidth={2.5} className="text-ink" />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-4 min-h-0">
                  {/* Product Grid */}
                  {view === 'grid' && (
                    <div className="mt-4">
                      <div className="mb-4">
                        <input
                          type="text"
                          placeholder="Search products..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body focus:outline-none focus:ring-2 focus:ring-ink"
                        />
                      </div>

                      {filteredProducts.length === 0 ? (
                        <div className="bg-light harsh-border rounded-sm p-8 text-center">
                          <p className="text-sm font-medium text-ink">No products found</p>
                          <p className="text-xs text-muted-text mt-1">Try another search or add products in Inventory.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 pb-6">
                          {filteredProducts.map((p) => {
                            const inCart = cart.find((i) => i.product_id === p.id)
                            return (
                              <button
                                key={p.id}
                                onClick={() => addToCart(p.id)}
                                disabled={p.quantity < 1}
                                className="btn-tactile relative bg-light harsh-border rounded-sm p-3 flex flex-col items-center gap-2 active:bg-warm-gray disabled:opacity-40"
                              >
                                {inCart && (
                                  <span className="absolute top-1 right-1 min-w-5 h-5 px-1 rounded-full bg-accent-red text-white text-xs font-bold flex items-center justify-center">
                                    {inCart.quantity}
                                  </span>
                                )}
                                <ProductIcon category={p.category} size={36} />
                                <span className="text-sm font-medium text-center leading-tight">{p.name}</span>
                                <span className="text-xs text-muted-text">{formatCurrency(p.selling_price)}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cart */}
                  {view === 'cart' && (
                    <div className="mt-4">
                      {/* Cart lines */}
                      <div className="space-y-3 mb-4">
                        {cart.map((i) => (
                          <div key={i.product_id} className="bg-light harsh-border rounded-sm p-3 flex items-center gap-3">
                            <ProductIcon category={i.category} size={32} />
                            <div className="flex-1 min-w-0">
                              <p className="font-display text-base uppercase truncate">{i.name}</p>
                              <p className="text-xs text-muted-text">
                                {formatCurrency(i.unit_price)} · {formatCurrency(i.unit_price * i.quantity)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => changeQty(i.product_id, -1)}
                                className="btn-tactile w-9 h-9 bg-warm-gray flex items-center justify-center rounded-sm"
                              >
                                <Minus size={16} strokeWidth={2.5} className="text-ink" />
                              </button>
                              <span className="font-display text-xl text-ink w-7 text-center">{i.quantity}</span>
                              <button
                                onClick={() => changeQty(i.product_id, 1)}
                                className="btn-tactile w-9 h-9 bg-warm-gray flex items-center justify-center rounded-sm"
                              >
                                <Plus size={16} strokeWidth={2.5} className="text-ink" />
                              </button>
                              <button
                                onClick={() => removeFromCart(i.product_id)}
                                className="btn-tactile w-9 h-9 flex items-center justify-center rounded-sm"
                              >
                                <Trash2 size={16} className="text-accent-red" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Add more */}
                      <button
                        onClick={() => setView('grid')}
                        className="btn-tactile w-full py-3 mb-4 bg-light harsh-border rounded-sm font-display text-sm uppercase tracking-wider text-ink flex items-center justify-center gap-2"
                      >
                        <Plus size={16} strokeWidth={2.5} /> Add More Products
                      </button>

                      {/* Payment Method */}
                      <div className="mb-4">
                        <p className="text-micro text-muted-text mb-2">PAYMENT METHOD</p>
                        <div className="flex gap-2">
                          {paymentOptions.map((opt) => (
                            <button
                              key={opt.key}
                              onClick={() => setPaymentMethod(opt.key)}
                              className={`btn-tactile flex-1 py-3 font-display text-sm uppercase tracking-wider rounded-sm border-2 transition-colors ${
                                paymentMethod === opt.key
                                  ? 'bg-ink text-white border-ink'
                                  : 'bg-light text-ink border-ink'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Customer (optional) */}
                      <div className="mb-4">
                        <button
                          onClick={() => setShowCustomerForm(!showCustomerForm)}
                          className="flex items-center gap-2 text-micro text-muted-text"
                        >
                          <User size={14} />
                          {showCustomerForm ? 'HIDE CUSTOMER INFO' : 'ADD CUSTOMER (OPTIONAL)'}
                        </button>
                        {showCustomerForm && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            className="mt-3 space-y-3 overflow-hidden"
                          >
                            {state.customers.length > 0 && (
                              <div className="relative">
                                <select
                                  onChange={(e) => {
                                    if (!e.target.value) return
                                    const c = state.customers.find((c) => c.id === e.target.value)
                                    if (c) {
                                      setCustomerName(c.name)
                                      setCustomerPhone(c.phone || '')
                                    }
                                  }}
                                  className="w-full h-12 px-4 bg-light harsh-border rounded-sm text-base font-body text-ink"
                                >
                                  <option value="">Select saved customer...</option>
                                  {state.customers.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <div className="relative">
                              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
                              <input
                                type="text"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="Customer name"
                                className="w-full h-12 pl-10 pr-4 bg-light harsh-border rounded-sm text-base font-body"
                              />
                            </div>
                            <div className="relative">
                              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-text" />
                              <input
                                type="tel"
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                placeholder="Phone number (for receipt)"
                                className="w-full h-12 pl-10 pr-4 bg-light harsh-border rounded-sm text-base font-body"
                              />
                            </div>
                          </motion.div>
                        )}
                      </div>

                      {/* Total Display */}
                      <div className="bg-ink rounded-sm p-5 mb-4">
                        <div className="flex justify-between items-baseline">
                          <span className="text-white/60 text-micro">TOTAL · {itemCount} {itemCount === 1 ? 'ITEM' : 'ITEMS'}</span>
                          <span className="font-display text-3xl text-white">{formatCurrency(total)}</span>
                        </div>
                        <div className="flex justify-between items-baseline mt-1">
                          <span className="text-white/40 text-xs">PROFIT</span>
                          <span className="text-accent-green text-sm font-medium">+{formatCurrency(profit)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Save button - STICKY AT BOTTOM */}
                {view === 'cart' && cart.length > 0 && (
                  <div className="px-5 pt-4 pb-24 bg-sand border-t-2 border-ink flex-shrink-0 mt-auto shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
                    <button
                      onClick={handleConfirm}
                      disabled={cart.length === 0 || saving}
                      className="btn-tactile w-full h-14 bg-ink text-white font-display text-lg uppercase tracking-wider rounded-sm disabled:opacity-50"
                    >
                      {saving ? '...' : 'CONFIRM SALE'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

> **NOTE TO IMPLEMENTER:** The function name in the code above must be `removeFromCart` (ASCII). When typing it, ensure both the definition and the call site (`onClick={() => removeFromCart(i.product_id)}`) use identical ASCII spelling. Do not copy any non-ASCII lookalike character.

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: PASS, no type errors, no unused-import warnings (every imported icon — `X, Minus, Plus, Check, User, Phone, Trash2, ArrowLeft` — is used).

- [ ] **Step 3: Commit**

```bash
git add src/components/AddSaleSheet.tsx
git commit -m "feat: multi-product cart in New Sale flow"
```

---

### Task 4: Manual verification

**Files:** none (manual).

- [ ] **Step 1: Run the app**

Run: `npm run dev`
Open the served URL, log in.

- [ ] **Step 2: Single-product regression**

Open New Sale (red + button) → tap one product → cart shows 1 line → set qty 2 → CONFIRM. Verify: success screen shows total + "1 item"... (one product line, qty 2). Check Report/Home dashboard today-sales increased by `2 × price`; stock for that product dropped by 2.

- [ ] **Step 3: Multi-product checkout**

Open New Sale → tap product A → "Add More Products" → tap product B → set distinct quantities → pick MOMO → add a customer name + phone → CONFIRM.
Verify:
- Success screen shows grand total + correct item count.
- Report list shows **two new sale rows** (A and B), both MOMO, both with the customer name, same timestamp.
- Dashboard today-sales increased by grand total; today-profit by combined profit.
- Stock for A and B each decremented by their cart quantities.
- Customer `total_purchases` (Customers/Settings, wherever shown) increased by grand total **once**.

- [ ] **Step 4: Stock cap**

Add a product with low stock (e.g. 3 in stock). In cart, press `+` past 3 — quantity must cap at 3. In grid, a product with 0 stock must be disabled.

- [ ] **Step 5: Empty-cart guard**

Open New Sale, add a product, remove it (trash). View returns to grid; there is no CONFIRM button until a product is in the cart.

- [ ] **Step 6: Offline fallback (optional)**

With network throttled/offline, confirm a 2-item cart. Toast says "Sale saved locally"; both rows appear; stock decrements locally.

- [ ] **Step 7: Final commit (if any doc/notes updated)**

```bash
git add -A
git commit -m "chore: verify multi-product sale flow" --allow-empty
```
```

---

## Self-Review

**Spec coverage:**
- Cart state + shared payment/customer → Task 3 ✓
- Multiple sale rows on confirm → Task 1 (`recordSaleBatch`) + Task 2 (`addSaleBatch`) + Task 3 (`handleConfirm`) ✓
- Block overselling → Task 3 (`Math.min(stock,...)`, disabled 0-stock grid button) + Task 4 Step 4 ✓
- One refresh, not N → Task 2 ✓
- Offline fallback (batched) → Task 2 + Task 4 Step 6 ✓
- Customer aggregation by grand total, once → Task 3 + Task 4 Step 3 ✓
- Receipt/success shows grand total + item count → Task 3 ✓
- No schema/type change; `addSale`/`recordSale` kept → Tasks 1 & 2 only add functions ✓

**Placeholder scan:** none — all steps have concrete code/commands.

**Type consistency:** `recordSaleBatch(sales, items)` signature identical in Task 1 (def), Task 2 (call). `addSaleBatch(sales, items)` identical in Task 2 type, impl, and Task 3 call. `CartItem` fields used consistently in `addToCart`/`changeQty`/`handleConfirm`. Sale-row object matches `Sale` type fields (id, product_id, product_name, quantity, unit_price, total, profit, customer_name, customer_phone, payment_method, created_at; `user_id` added in API).
