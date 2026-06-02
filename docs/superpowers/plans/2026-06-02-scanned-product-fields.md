# Scanned Product Fields (Unit + Category) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Unit and Category inputs to the scanned-item sheet and the manual-add sheet so scanning captures the same fields as Inventory's Add Product.

**Architecture:** All changes in `BarcodeScanner.tsx`. Add shared `UNIT_OPTIONS`/`CATEGORY_OPTIONS` consts, bind a Unit dropdown + Category button-grid to the existing `currentItem.unit/category` (scanned sheet) and to new `manualUnit/manualCategory` state (manual sheet), fix `'unit'` defaults to `'piece'`, and stop hardcoding unit/category on the manual add.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, lucide-react.

**Testing note:** No unit-test runner (scripts: `dev`, `build`, `lint`, `preview`). Verification = `npm run build` + `npm run lint` + manual scan. Do not add a test framework.

---

### Task 1: Option consts, manual state, reset helper

**Files:**
- Modify: `src/components/BarcodeScanner.tsx` (module scope near other top-level consts; component state ~line 176-179)

- [ ] **Step 1: Add option consts at module scope**

Add directly below the existing `NATIVE_FORMATS` const block (top of file, before the component):

```ts
// Mirror Inventory's Add Product options so scanned items capture the same data.
const UNIT_OPTIONS = [
  { value: 'piece', label: 'Pc' },
  { value: 'tin', label: 'Tin' },
  { value: 'bag', label: 'Bag' },
  { value: 'bottle', label: 'Btl' },
  { value: 'pack', label: 'Pack' },
  { value: 'loaf', label: 'Loaf' },
  { value: 'kg', label: 'Kg' },
]
const CATEGORY_OPTIONS = ['Groceries', 'Dairy', 'Beverages', 'Cooking', 'Grains', 'Canned', 'Noodles', 'Bakery']
```

- [ ] **Step 2: Add manual unit/category state**

After line 179 (`const [manualQty, setManualQty] = useState(1)`), add:

```ts
  const [manualUnit, setManualUnit] = useState('piece')
  const [manualCategory, setManualCategory] = useState('Groceries')
```

- [ ] **Step 3: Add a `resetManual` helper**

Immediately after the two new state lines from Step 2, add:

```ts
  const resetManual = useCallback(() => {
    setManualName('')
    setManualCost('')
    setManualPrice('')
    setManualQty(1)
    setManualUnit('piece')
    setManualCategory('Groceries')
  }, [])
```

(`useCallback` is already imported.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: `✓ built` (new symbols unused so far — fine; `resetManual` is referenced in Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/components/BarcodeScanner.tsx
git commit -m "feat: scanner unit/category option consts and manual state"
```

---

### Task 2: Wire defaults, manual add, and reset call sites

**Files:**
- Modify: `src/components/BarcodeScanner.tsx` (lines ~395, 419, 438, 455 unit defaults; ~968-969 manual add; reset clusters at ~367-370, ~461-464, ~973-976, and three inline at ~766/1039/1048)

- [ ] **Step 1: Fix `unit` defaults (QR + known + API + unknown paths)**

Make these four replacements:

```ts
          unit: json.unit || 'unit',
```
→
```ts
          unit: json.unit || 'piece',
```

```ts
        unit: existing.unit || 'unit',
```
→
```ts
        unit: existing.unit || 'piece',
```

The API path (unique because the next line is `category: apiData.category,`):
```ts
        quantity: 1,
        unit: 'unit',
        category: apiData.category,
```
→
```ts
        quantity: 1,
        unit: 'piece',
        category: apiData.category,
```

The unknown-barcode path (unique because preceded by `quantity: 1,` at 6-space indent and followed by `category: 'Groceries',`):
```ts
      quantity: 1,
      unit: 'unit',
      category: 'Groceries',
```
→
```ts
      quantity: 1,
      unit: 'piece',
      category: 'Groceries',
```

- [ ] **Step 2: Use manual state in the manual add**

In the manual sheet's `addToBasket({...})` (unique because preceded by `quantity: manualQty,`):

```ts
                      quantity: manualQty,
                      unit: 'unit',
                      category: 'Groceries',
```
→
```ts
                      quantity: manualQty,
                      unit: manualUnit,
                      category: manualCategory,
```

- [ ] **Step 3: Swap the three inline reset runs**

Replace **all occurrences** of this exact one-liner fragment (appears 3×, at ~766/1039/1048):

```ts
setManualName(''); setManualCost(''); setManualPrice(''); setManualQty(1);
```
→
```ts
resetManual();
```

- [ ] **Step 4: Swap the multiline reset cluster (6-space, followed by setCameraError)**

```ts
      setManualName('')
      setManualCost('')
      setManualPrice('')
      setManualQty(1)
      setCameraError(null)
```
→
```ts
      resetManual()
      setCameraError(null)
```

- [ ] **Step 5: Swap the multiline reset cluster (4-space, end of a useCallback)**

```ts
    setScanMode('manual')
    setManualName('')
    setManualCost('')
    setManualPrice('')
    setManualQty(1)
  }, [state.products])
```
→
```ts
    setScanMode('manual')
    resetManual()
  }, [state.products])
```

- [ ] **Step 6: Swap the multiline reset cluster (inside manual ADD onClick, 20-space)**

```ts
                    setManualName('')
                    setManualCost('')
                    setManualPrice('')
                    setManualQty(1)
                  }}
```
→
```ts
                    resetManual()
                  }}
```

- [ ] **Step 7: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors in `BarcodeScanner.tsx`. (`resetManual` now referenced; `manualUnit`/`manualCategory` read in Step 2.)

- [ ] **Step 8: Commit**

```bash
git add src/components/BarcodeScanner.tsx
git commit -m "feat: scanned/manual add use chosen unit/category, default piece"
```

---

### Task 3: Unit + Category UI in the scanned-item sheet

**Files:**
- Modify: `src/components/BarcodeScanner.tsx` (scanned sheet, after the Cost/Selling grid that closes ~line 1122, before the Projected Profit block ~line 1124)

- [ ] **Step 1: Insert the Unit dropdown + Category grid**

Between the closing `</div>` of the `grid grid-cols-2` Cost/Selling block and the `{/* projected */}`/Projected Profit block, insert:

```tsx
                  <div className="mb-4">
                    <label className="text-micro text-muted-text mb-1 block">UNIT</label>
                    <select
                      value={currentItem.unit}
                      onChange={(e) => setCurrentItem((prev) => prev ? { ...prev, unit: e.target.value } : null)}
                      className="w-full h-12 bg-white harsh-border rounded-sm px-3 font-body text-base text-ink"
                    >
                      {UNIT_OPTIONS.map((u) => (
                        <option key={u.value} value={u.value}>{u.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="mb-5">
                    <label className="text-micro text-muted-text mb-2 block">CATEGORY</label>
                    <div className="grid grid-cols-2 gap-2">
                      {CATEGORY_OPTIONS.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setCurrentItem((prev) => prev ? { ...prev, category: cat } : null)}
                          className={`py-2.5 font-display text-xs uppercase tracking-wider rounded-sm border-2 ${
                            currentItem.category === cat ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>
```

Anchor: it goes immediately before the existing
`<div className="bg-accent-green/10 rounded-sm p-3 mb-5">` that holds "Projected Profit" inside the `showItemSheet && currentItem` block.

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/BarcodeScanner.tsx
git commit -m "feat: unit + category fields in scanned product sheet"
```

---

### Task 4: Unit + Category UI in the manual-add sheet

**Files:**
- Modify: `src/components/BarcodeScanner.tsx` (manual sheet, before its Projected Profit block ~line 946)

- [ ] **Step 1: Insert the Unit dropdown + Category grid**

Immediately before the manual sheet's `{/* Projected profit */}` block (the
`<div className="bg-accent-green/10 rounded-sm p-3 mb-5">` whose profit uses
`manualPrice`/`manualCost`), insert:

```tsx
              <div className="mb-4">
                <label className="text-micro text-muted-text mb-1 block">UNIT</label>
                <select
                  value={manualUnit}
                  onChange={(e) => setManualUnit(e.target.value)}
                  className="w-full h-12 bg-white harsh-border rounded-sm px-3 font-body text-base text-ink"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
              </div>

              <div className="mb-5">
                <label className="text-micro text-muted-text mb-2 block">CATEGORY</label>
                <div className="grid grid-cols-2 gap-2">
                  {CATEGORY_OPTIONS.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setManualCategory(cat)}
                      className={`py-2.5 font-display text-xs uppercase tracking-wider rounded-sm border-2 ${
                        manualCategory === cat ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npm run lint`
Expected: `✓ built`; no new errors in `BarcodeScanner.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/BarcodeScanner.tsx
git commit -m "feat: unit + category fields in manual add sheet"
```

---

### Task 5: Manual verification

**Files:** none.

- [ ] **Step 1: Run the app**

Run: `npm run dev`, open scanner.

- [ ] **Step 2: Scanned product**

Scan a known/database product. The sheet shows: Quantity, Cost, Selling, **UNIT
dropdown (Pc selected)**, **CATEGORY grid (Groceries highlighted)**, Projected
Profit, ADD TO DELIVERY. Change unit to e.g. Bottle and category to Beverages,
ADD TO DELIVERY, finalize the delivery, then open Inventory → the product shows
that unit and category.

- [ ] **Step 3: Manual add**

Use ADD MANUALLY / NEW BARCODE. Confirm the same UNIT + CATEGORY controls appear,
default Pc / Groceries. Set them, ADD TO DELIVERY, finalize → Inventory item
reflects the chosen unit/category (not the old hardcoded `unit`/Groceries).

- [ ] **Step 4: Reset check**

After adding a manual item, reopen the manual sheet → unit resets to Pc, category
to Groceries (resetManual covers them).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verify scanned product unit/category fields" --allow-empty
```

---

## Self-Review

**Spec coverage:**
- `UNIT_OPTIONS`/`CATEGORY_OPTIONS` consts → Task 1 Step 1 ✓
- Scanned sheet Unit dropdown + Category grid bound to `currentItem` → Task 3 ✓
- `unit` default `'unit'`→`'piece'` (all four setCurrentItem sites) → Task 2 Step 1 ✓
- Manual state `manualUnit`/`manualCategory` → Task 1 Step 2 ✓
- Manual sheet Unit + Category UI → Task 4 ✓
- Manual add uses chosen unit/category (was hardcoded) → Task 2 Step 2 ✓
- Manual resets include the new fields → Task 1 Step 3 + Task 2 Steps 3-6 ✓
- Category button-grid markup matches Add Product styling → Tasks 3/4 ✓

**Placeholder scan:** none — every step has exact before/after code and anchors.

**Consistency:** `UNIT_OPTIONS` (objects `{value,label}`) and `CATEGORY_OPTIONS`
(strings) defined in Task 1 are consumed identically in Tasks 3/4. `manualUnit`/
`manualCategory` defined Task 1, read in Task 2 Step 2 and bound in Task 4.
`resetManual` defined Task 1, substituted at all six reset sites in Task 2 Steps
3-6. The selected-button class string `bg-ink text-white border-ink` /
`bg-light text-ink border-ink` matches the Add Product convention. `currentItem`
is the existing scanned-item state object with pre-existing `unit`/`category`
fields.
