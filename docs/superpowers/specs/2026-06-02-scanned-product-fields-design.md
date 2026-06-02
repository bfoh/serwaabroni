# Scanned Product Fields Match Add Product — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Component:** `src/components/BarcodeScanner.tsx` (single file)

## Problem

The scanned-product sheet (the "FROM DATABASE" / "KNOWN PRODUCT" / "QR DELIVERY"
detail sheet, and the manual "ADD MANUALLY / NEW BARCODE" sheet) only captures
**Quantity / Cost Price / Selling Price**. The Add Product form in Inventory also
captures **Unit** and **Category**. As a result, products added via scanning land
in inventory with hardcoded `unit` and `category`, and the user cannot set them
at scan time. The user wants the scanned sheet to capture the same fields as Add
Product.

## Goals

- Scanned-item detail sheet captures **Unit** and **Category**, matching Add
  Product's options.
- Manual-add sheet captures the same two fields (currently hardcodes
  `unit: 'unit'`, `category: 'Groceries'`).
- Category uses the same button-grid UI as Add Product; Unit uses the same
  dropdown options.

## Non-Goals

- No change to the Inventory Add Product form.
- No schema/data change — `ScannedItem` and the basket already carry `unit` and
  `category`; the delivery→inventory insert already reads them.
- No new fields beyond Unit and Category (Add Product also has Product Name,
  Cost, Selling, Quantity — all already present on the scanned sheet).

## Current State (verified)

- `ScannedItem` interface already has `unit: string` and `category: string`.
- Scanned sheet (`showItemSheet && currentItem`) renders Quantity stepper, Cost,
  Selling, Projected Profit, then Cancel / ADD TO DELIVERY. Its ADD button calls
  `addToBasket(currentItem)`, so `currentItem.unit`/`.category` already flow
  through — only the UI inputs are missing.
- Manual sheet's ADD calls `addToBasket({ … unit: 'unit', category: 'Groceries' …})`
  — hardcoded.
- Some `setCurrentItem` sites default `unit` to the string `'unit'`, which is not
  a valid dropdown option.
- Inventory option lists (to mirror): units `piece/tin/bag/bottle/pack/loaf/kg`
  (labels `Pc/Tin/Bag/Btl/Pack/Loaf/Kg`); categories `Groceries, Dairy,
  Beverages, Cooking, Grains, Canned, Noodles, Bakery`.

## Design

### 1. Shared option constants (module scope, top of `BarcodeScanner.tsx`)

```ts
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

### 2. Scanned-item sheet — add Unit + Category

Between the Cost/Selling grid and the Projected Profit block, insert:

- **UNIT**: label + `<select value={currentItem.unit}>` mapping `UNIT_OPTIONS`;
  `onChange` → `setCurrentItem(prev => prev ? { ...prev, unit: e.target.value } : null)`.
- **CATEGORY**: label + a 2-column button grid over `CATEGORY_OPTIONS`. Selected
  (`currentItem.category === cat`) renders with the ink/selected style (same as
  Add Product's `bg-ink text-white border-ink` vs `bg-light text-ink border-ink`);
  click → `setCurrentItem(prev => prev ? { ...prev, category: cat } : null)`.

ADD TO DELIVERY handler unchanged (`addToBasket(currentItem)`).

### 3. Fix scanned `unit` defaults

At the `setCurrentItem({...})` sites that set `unit: json.unit || 'unit'`,
`unit: 'unit'` (API path), and the manual-fallback (`unit: 'unit'`), change the
`'unit'` fallback to `'piece'` so the dropdown shows a valid selection. The
existing-product path (`unit: existing.unit || 'unit'`) becomes
`existing.unit || 'piece'`. Category defaults remain `'Groceries'`.

### 4. Manual-add sheet — add state + fields

- New state: `const [manualUnit, setManualUnit] = useState('piece')` and
  `const [manualCategory, setManualCategory] = useState('Groceries')`.
- Render the same UNIT dropdown + CATEGORY button grid (bound to
  `manualUnit`/`manualCategory`) before the Projected Profit block in the manual
  sheet.
- In the manual ADD TO DELIVERY `addToBasket({...})`, replace
  `unit: 'unit', category: 'Groceries'` with `unit: manualUnit, category: manualCategory`.
- Reset both on add: add `setManualUnit('piece'); setManualCategory('Groceries')`
  alongside the existing `setManualName('')` etc. resets (in the ADD handler and
  in the other manual-reset sites that clear `manualName/Cost/Price/Qty`).

### 5. Category button-grid markup (used in both sheets)

```tsx
<div className="mb-5">
  <label className="text-micro text-muted-text mb-2 block">CATEGORY</label>
  <div className="grid grid-cols-2 gap-2">
    {CATEGORY_OPTIONS.map((cat) => (
      <button
        key={cat}
        type="button"
        onClick={() => /* set category on currentItem or manualCategory */}
        className={`py-2.5 font-display text-xs uppercase tracking-wider rounded-sm border-2 ${
          selected === cat ? 'bg-ink text-white border-ink' : 'bg-light text-ink border-ink'
        }`}
      >
        {cat}
      </button>
    ))}
  </div>
</div>
```

(Two instances: one bound to `currentItem.category`, one to `manualCategory`.
Inlined in each sheet — same markup, different binding.)

## Affected File

- `src/components/BarcodeScanner.tsx` — option consts; Unit+Category UI in the
  scanned sheet and the manual sheet; `unit` default fix; manual state + reset;
  manual `addToBasket` unit/category.

## No-Break Guarantees

- `ScannedItem`/basket shape unchanged (fields already exist).
- Scanned sheet's add path already forwards `currentItem.unit/category`.
- Inventory Add Product and the delivery→inventory insert are untouched and
  already consume `unit`/`category`.

## Testing / Verification

No unit-test runner; verification = `npm run build` + `npm run lint` + manual:

- **Scanned product:** scan a known/database product → sheet shows Unit dropdown
  (default Piece) + Category grid (default Groceries highlighted). Change both,
  ADD TO DELIVERY, finalize → the product in Inventory has the chosen unit and
  category.
- **Manual add:** ADD MANUALLY → set unit + category → ADD TO DELIVERY → finalize
  → inventory item reflects the choices (not the old hardcoded `unit`/Groceries).
- **Defaults:** a freshly scanned item shows Piece selected in the dropdown (not
  a blank/invalid `unit`).
- **Regression:** Quantity/Cost/Selling/Projected Profit and the delivery basket
  still work; Inventory Add Product unchanged.
