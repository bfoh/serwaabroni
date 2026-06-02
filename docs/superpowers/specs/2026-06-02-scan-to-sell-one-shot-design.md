# Scan-to-Sell One-Shot Flow — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Supersedes the interaction model in:** `2026-06-02-scan-to-sell-design.md`
(continuous auto-add). The architecture (shared `useScanCamera`, `SaleScanner`,
cart) is unchanged; only the scan→cart interaction changes.

## Problem

The current sales scanner runs continuously: each detected barcode silently adds
the product and the camera keeps scanning. The user wants, instead: scan one
product → the sale page opens so they can review and set the quantity → they can
tap to scan the next product → repeat until they confirm the sale.

## Goals

- One scan adds the matched product, then the scanner closes and returns to the
  New Sale sheet (cart view) where quantity is set with the existing ± controls.
- From the cart, the user can reopen the scanner to add the next product.
- The sale is finalized only by the existing CONFIRM SALE button.

## Non-Goals

- No change to `addToCart`, cart rendering, stock cap, checkout, or `addSaleBatch`.
- No change to the delivery scanner or the shared `useScanCamera` hook.
- No per-scan quantity prompt inside the camera; quantity is set on the cart page.

## Design

### 1. `SaleScanner` — close after one successful scan

In `src/components/SaleScanner.tsx`, `handleCode`:
- On a **match**: call `onProductScanned(product)` and then `onClose()` (close the
  camera immediately). Keep the brief vibrate; the "Added" toast still fires.
- On **out of stock**: toast, stay open (no add, no close).
- On **unknown code**: toast "Not in inventory", stay open so the user can try
  again.

The per-code cooldown ref and continuous behavior are removed (a single match
ends the session). The header tally/Done button remain (Done closes without a
scan).

### 2. Cart view — "Scan Next" button (`AddSaleSheet`)

`addToCart` already adds the product (qty 1) and sets `view = 'cart'`, so after a
scan the user is on the cart page with the item; the existing `−  qty  +`
controls set quantity.

Add a scan entry point in the cart view, beside the existing "Add More Products"
button: a compact button with a `ScanLine` icon labelled "Scan" that calls
`setShowScan(true)`. Layout: wrap "Add More Products" and "Scan" in a flex row so
"Add More Products" stays primary (flex-1) and "Scan" is a fixed-width icon
button, mirroring the grid-header search+scan pattern.

The grid-header SCAN button (first scan) is unchanged.

### 3. Flow

```
New Sale (grid) --SCAN--> SaleScanner --match--> addToCart + close --> cart (set qty)
cart --Scan Next--> SaleScanner --match--> addToCart + close --> cart (set qty)
... repeat ...
cart --CONFIRM SALE--> addSaleBatch (unchanged)
```

## No-Break Guarantees

- Only `SaleScanner.handleCode` (auto-close on match, drop cooldown) and
  `AddSaleSheet` (cart-view Scan button) change.
- `addToCart`, quantity controls, payment/customer, CONFIRM, `addSaleBatch`,
  stock cap, and the delivery scanner are untouched.

## Testing / Verification

No unit-test runner; verification = `npm run build` + `npm run lint` + manual:

- New Sale → SCAN → scan a stocked product → camera closes, cart shows the item
  at qty 1; adjust with ± .
- Cart → "Scan Next" → scan a different product → camera closes, cart now has two
  line items; quantities adjustable.
- Rescanning a product already in the cart increments its quantity (then closes).
- Unknown barcode → "Not in inventory", camera stays open.
- Out-of-stock product → toast, not added, camera stays open.
- CONFIRM SALE records the sale and decrements stock (unchanged).
