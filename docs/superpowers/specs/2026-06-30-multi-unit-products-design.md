# Multi-Unit Products (Pack ↔ Base) — Design

**Date:** 2026-06-30
**Status:** Approved design, pending implementation plan

## Problem

Some goods are bought and sold in two unit sizes: a bigger "pack" and a smaller
"base" unit. Examples:

- Indomie: 1 **box** = 10 **sachets**
- Sardines: 1 **box** = N **tins**

The shopkeeper wants to:

1. Restock by entering the bigger unit (e.g. "10 boxes") and have the app know
   that is also 100 sachets (10 × 10).
2. Sell in either unit — a sale smaller than a box (loose sachets) or a sale in
   whole boxes — and have stock deducted correctly each time.
3. See remaining stock as both the bigger and smaller unit
   (e.g. "9 box 5 sachet (95 sachets)").

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Pricing | **One base-unit price, auto-derive pack price.** Box price = base price × factor. No independent break-bulk premium. |
| Tiers | **Exactly 2** — one pack unit + one base unit, single conversion factor. |
| Existing products | **Leave as-is, opt-in.** Current products stay single-unit (`units_per_pack = 1`). Multi-unit is optional per product. No data backfill. |
| Sell UX | **Unit toggle on the cart line** — tap product once, toggle Box/Base per line. |
| Stock display | **Mixed** — "9 box 5 sachet (95 sachets)". |

## Core principle: store everything in **base units**

The base unit is the canonical internal unit. Stock quantity, stock batches,
sale quantity, and all prices are stored per base unit. The pack unit is a
*presentation layer* derived via the conversion factor.

This makes the feature backward-compatible for free and keeps FIFO, capital
tracking, the cash ledger, and `batch_consumptions` **completely untouched** —
they already operate in base units.

### Product model changes

| Field | Status | Meaning |
|---|---|---|
| `unit` | existing | The **base** unit, e.g. `sachet`. (Single-unit products already use this.) |
| `pack_unit` | **new**, `text` nullable | Bigger unit name, e.g. `box`. `null` = single-unit product. |
| `units_per_pack` | **new**, `integer NOT NULL DEFAULT 1` | Conversion factor, integer ≥ 1. `1` = single-unit. |
| `quantity` | existing | Stock in **base** units — unchanged. |
| `cost_price` / `selling_price` | existing | **Per base unit** — unchanged. |

Derived values (never stored):
- Pack selling price = `selling_price × units_per_pack`
- Pack cost = `cost_price × units_per_pack`

**Backward compatibility:** existing products get `pack_unit = null`,
`units_per_pack = 1` by default. `quantity`/prices are already base. Nothing
migrates.

### Sale model changes (display only)

`Sale.quantity` is ambiguous for display (base `20` could mean "2 boxes" or
"20 sachets"). To render "sold as 2 boxes" on receipts/history, add two
**display-only** columns. The math layer ignores them.

| Field | Status | Meaning |
|---|---|---|
| `quantity` | existing | **Base** units sold — drives `total`, `profit`, FIFO. Unchanged. |
| `unit_price` | existing | **Per base unit.** `unit_price × quantity = total` stays correct. |
| `sale_unit` | **new**, `text` nullable | Unit label the seller chose, e.g. `box`. `null`/`base` for base-unit sales. |
| `sale_unit_qty` | **new**, `numeric` nullable | Quantity in the chosen unit, e.g. `2`. |

Example: sell 2 boxes of Indomie (factor 10, base price 3.00):
`quantity = 20`, `unit_price = 3.00`, `total = 60.00`, `sale_unit = 'box'`,
`sale_unit_qty = 2`. All existing aggregations stay correct; receipt shows
"2 box".

## New module: `src/lib/units.ts` (pure, unit-tested)

```ts
type UnitKind = 'pack' | 'base'

// Convert a quantity expressed in `kind` to base units.
toBase(qty: number, kind: UnitKind, product: Product): number

// Split a base quantity into whole packs + loose base units.
splitStock(baseQty: number, factor: number): { packs: number; loose: number }

// "9 box 5 sachet (95 sachets)" — or "95 sachet" when single-unit.
formatStock(product: Product): string

// Unit price for the chosen kind (base => selling_price, pack => × factor).
priceFor(product: Product, kind: UnitKind): number
costFor(product: Product, kind: UnitKind): number

// True when the product sells in packs (pack_unit set and factor > 1).
isMultiUnit(product: Product): boolean
```

Guards: `units_per_pack` must be an integer ≥ 1; if a product is multi-unit,
`pack_unit` must be non-empty. `toBase` with `kind='pack'` multiplies by factor;
with `kind='base'` returns qty unchanged. For single-unit products `priceFor`
and `toBase` behave identically for both kinds (factor 1).

## UI changes

### Add / Edit Product (`src/pages/Inventory.tsx`)

- New **"Sold in packs?"** toggle. When on, reveal:
  - Pack unit name (default options: box, carton, bag, crate, …)
  - Units per pack (integer input, ≥ 2)
  - Base unit = the existing UNIT selector, relabeled "smaller unit"
- Cost/Selling Price fields labeled **"per {base unit}"**, with a live derived
  hint: `= GH₵30.00 / box`.
- QUANTITY field gains a **box | base** toggle; converted to base via `toBase`
  on submit.
- Validation: factor integer ≥ 1; if "sold in packs" on, `pack_unit` required
  and factor ≥ 2.

### Restock (`src/pages/Inventory.tsx`, restock handler ~line 200)

- Same **box | base** toggle on the restock quantity.
- Convert to base, then call existing `receiveStock` with base qty. `unit_cost`
  stays per base unit. **No `batchApi` change.**

### Sell (`src/components/AddSaleSheet.tsx`)

- Cart line item gains `unitKind: UnitKind` (default `'base'`).
- Multi-unit products render a **Box | Sachet** toggle on the line.
- Line unit price comes from `priceFor(product, unitKind)`.
- Stock cap: `lineQtyInChosenUnit × factor ≤ remaining base stock`. The stepper
  max is shown in the chosen unit. The **Box** option is disabled when remaining
  base stock < factor (can't sell a full box from loose stock).
- On submit: convert each line to base via `toBase`. Populate `Sale.quantity`
  (base), `unit_price` (per base), `sale_unit`, `sale_unit_qty`.

### Display surfaces

- **Inventory list:** use `formatStock` (mixed).
- **AddSaleSheet stepper:** show stock in the chosen unit.
- **ReceiptModal / sales history (Home, Reports):** show "2 box" when
  `sale_unit` present, else "20 sachet".
- **Low-stock threshold:** stays in base units; displayed mixed. (No threshold
  unit toggle — out of scope.)

## Migration: `src/db/migration_020_product_units.sql`

```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pack_unit text,
  ADD COLUMN IF NOT EXISTS units_per_pack integer NOT NULL DEFAULT 1;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sale_unit text,
  ADD COLUMN IF NOT EXISTS sale_unit_qty numeric;
```

No data backfill — defaults make every existing row a correct single-unit
product. The Supabase realtime publication already includes these tables.

## Persistence (`src/services/supabaseApi.ts`)

`insertProduct`, `recordSale`, and `recordSaleBatch` all insert via
`.insert({ ...obj, user_id })` (full spread). New fields flow through
automatically once they are on the `Product`/`Sale` types and populated by
callers. **No column-listing edits needed** — only the types in `supabase.ts`
and the form/cart code that builds the objects.

## What does NOT change

- `src/lib/fifo.ts` and `batchApi` — operate on base units already.
- `batch_consumptions`, capital tracking, cash ledger — base units already.
- Profit/total/report aggregations — read base `quantity` and per-base
  `unit_price`.

## Edge cases

- **Loose stock < factor:** Box toggle disabled; only base-unit sale allowed.
- **Factor changed after stock exists:** base `quantity` unchanged; only display
  recomputes. Allow, but warn in the edit form.
- **Oversell / untracked FIFO:** unchanged; handled in base units.
- **Single-unit products:** factor 1, `pack_unit` null — every helper degrades
  to identity; no toggles shown.

## Testing

- `src/lib/units.test.ts`: `toBase` (pack & base, factor 1), `splitStock`
  (whole packs, partial, zero), `formatStock` (multi-unit, single-unit),
  `priceFor`/`costFor`, guard behavior on bad factors.
- Existing `fifo.test.ts`, capital and cash tests must stay green (proves base-
  unit invariants untouched).

## Files touched

**New**
- `src/lib/units.ts`
- `src/lib/units.test.ts`
- `src/db/migration_020_product_units.sql`

**Edit**
- `src/lib/supabase.ts` — `Product` + `Sale` types
- `src/pages/Inventory.tsx` — add/edit/restock forms + list display
- `src/components/AddSaleSheet.tsx` — unit toggle, price, cap, submit conversion
- `src/components/ReceiptModal.tsx` — sold-unit display
- `src/pages/Home.tsx`, `src/pages/Reports.tsx` — sale-line display
