# Scan-to-Sell One-Shot Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the sales scanner from continuous auto-add to one-shot: scan a product → camera closes → user sets quantity on the cart page → can reopen the scanner for the next product.

**Architecture:** Two small edits — `SaleScanner.handleCode` closes after one matched scan; `AddSaleSheet` cart view gains a "Scan" button beside "Add More Products". No other code changes.

**Tech Stack:** React 19, TypeScript, Vite, lucide-react.

**Testing note:** No unit-test runner (scripts: `dev`, `build`, `lint`, `preview`). Verification = `npm run build` + `npm run lint` + manual scan. Do not add a test framework.

---

### Task 1: `SaleScanner` closes after one matched scan

**Files:**
- Modify: `src/components/SaleScanner.tsx` (`handleCode`; remove the cooldown ref)

- [ ] **Step 1: Rewrite `handleCode` to one-shot**

Replace the existing `handleCode` callback:

```tsx
  const handleCode = useCallback((raw: string) => {
    const target = normalizeBarcode(raw)
    if (!target) return
    const now = Date.now()
    if (lastCodeRef.current.code === target && now - lastCodeRef.current.at < COOLDOWN_MS) return
    lastCodeRef.current = { code: target, at: now }

    const product = state.products.find(
      (p) => normalizeBarcode(p.barcode) === target || normalizeBarcode(p.qr_code) === target
    )
    if (product) {
      if (product.quantity < 1) { showToast(`${product.name} is out of stock`, 'error'); return }
      onProductScanned(product)
      setFlash(true)
      setTimeout(() => setFlash(false), 250)
      try { navigator.vibrate?.(60) } catch { /* no haptics */ }
      showToast(`Added ${product.name}`, 'success')
    } else {
      showToast('Not in inventory', 'error')
    }
  }, [state.products, onProductScanned, showToast])
```

with:

```tsx
  const handledRef = useRef(false)

  const handleCode = useCallback((raw: string) => {
    if (handledRef.current) return
    const target = normalizeBarcode(raw)
    if (!target) return

    const product = state.products.find(
      (p) => normalizeBarcode(p.barcode) === target || normalizeBarcode(p.qr_code) === target
    )
    if (!product) { showToast('Not in inventory', 'error'); return }
    if (product.quantity < 1) { showToast(`${product.name} is out of stock`, 'error'); return }

    // One-shot: add the product, then close so the user sets quantity on the cart.
    handledRef.current = true
    try { navigator.vibrate?.(60) } catch { /* no haptics */ }
    onProductScanned(product)
    showToast(`Added ${product.name}`, 'success')
    onClose()
  }, [state.products, onProductScanned, showToast, onClose])
```

- [ ] **Step 2: Reset the one-shot guard each time the scanner opens**

Add this effect after the `handleCode` definition (so a reopened scanner can scan
again):

```tsx
  useEffect(() => {
    if (isOpen) handledRef.current = false
  }, [isOpen])
```

Add `useEffect` to the React import at the top of the file:

```tsx
import { useRef, useState, useCallback, useEffect } from 'react'
```

- [ ] **Step 3: Remove the now-unused cooldown ref, flash state, and constant**

- Delete `const COOLDOWN_MS = 1200` (module constant).
- Delete `const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })`.
- Delete `const [flash, setFlash] = useState(false)` and the JSX block
  `{flash && <div className="absolute inset-0 bg-accent-green/40 pointer-events-none" />}`
  (the camera closes on a hit, so the flash never shows).

`useState` stays imported (no longer used by `flash`? — it is no longer used in
this file after removing `flash`; remove `useState` from the import if nothing
else uses it). Verify: after these deletions the only hooks used are `useRef`,
`useCallback`, `useEffect`. Update the import to:

```tsx
import { useRef, useCallback, useEffect } from 'react'
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no unused-symbol errors in `SaleScanner.tsx` (no leftover
`COOLDOWN_MS`/`lastCodeRef`/`flash`/`useState`).

Run: `grep -nE "COOLDOWN_MS|lastCodeRef|flash|useState" src/components/SaleScanner.tsx`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add src/components/SaleScanner.tsx
git commit -m "feat: sales scanner closes after one scan for quantity entry"
```

---

### Task 2: "Scan" button in the cart view

**Files:**
- Modify: `src/components/AddSaleSheet.tsx` (cart view, the "Add More Products" button block)

- [ ] **Step 1: Wrap "Add More Products" with a Scan button**

Replace the cart-view block:

```tsx
                      {/* Add more */}
                      <button
                        onClick={() => setView('grid')}
                        className="btn-tactile w-full py-3 mb-4 bg-light harsh-border rounded-sm font-display text-sm uppercase tracking-wider text-ink flex items-center justify-center gap-2"
                      >
                        <Plus size={16} strokeWidth={2.5} /> Add More Products
                      </button>
```

with:

```tsx
                      {/* Add more / scan next */}
                      <div className="flex gap-2 mb-4">
                        <button
                          onClick={() => setView('grid')}
                          className="btn-tactile flex-1 py-3 bg-light harsh-border rounded-sm font-display text-sm uppercase tracking-wider text-ink flex items-center justify-center gap-2"
                        >
                          <Plus size={16} strokeWidth={2.5} /> Add More
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowScan(true)}
                          aria-label="Scan next product"
                          className="btn-tactile px-4 py-3 bg-ink rounded-sm font-display text-sm uppercase tracking-wider text-white flex items-center justify-center gap-2"
                        >
                          <ScanLine size={18} /> Scan
                        </button>
                      </div>
```

(`ScanLine` and `setShowScan` already exist in this file from the scan-to-sell
work.)

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors in `AddSaleSheet.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/AddSaleSheet.tsx
git commit -m "feat: scan-next button in sale cart view"
```

---

### Task 3: Manual verification

**Files:** none.

- [ ] **Step 1:** `npm run dev` → New Sale → SCAN (grid header) → scan a stocked
  product → camera closes, cart shows it at qty 1.
- [ ] **Step 2:** Adjust quantity with `−`/`+`.
- [ ] **Step 3:** Tap "Scan" in the cart → scan a different product → camera
  closes, cart now has two items.
- [ ] **Step 4:** Rescan a product already in the cart → its quantity increments,
  camera closes.
- [ ] **Step 5:** Unknown barcode → "Not in inventory" toast, camera stays open;
  out-of-stock product → toast, not added, stays open.
- [ ] **Step 6:** CONFIRM SALE → records sale, stock decrements.
- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: verify one-shot scan-to-sell" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- One scan → add + close → cart for quantity → Task 1 ✓
- Unknown/out-of-stock keep camera open → Task 1 (returns without close) ✓
- Reopen scanner scans again (guard reset) → Task 1 Step 2 ✓
- "Scan Next" from cart → Task 2 ✓
- CONFIRM unchanged, addToCart/stock cap untouched → no task modifies them ✓

**Placeholder scan:** none — full before/after code and explicit grep check.

**Type consistency:** `handledRef` (boolean ref) introduced and used only in
Task 1. `onClose`/`onProductScanned`/`isOpen` are existing `SaleScannerProps`.
`setShowScan`/`ScanLine` already defined/imported in `AddSaleSheet` from prior
work. Import line reduced to the hooks actually used (`useRef`, `useCallback`,
`useEffect`).
