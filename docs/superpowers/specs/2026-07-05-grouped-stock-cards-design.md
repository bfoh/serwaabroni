# Grouped Stock Cards — Design Spec

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## 1. Summary

On the My Stock (Inventory) page, products that share the same name are shown as
**one card** instead of several. The card shows the item name once with a total
quantity, then lists each underlying product as a dated **stock entry** — each
keeping its own Re-stock / history / edit / delete actions and inline edit
behaviour. A product with a unique name renders exactly as it does today.

This is a **display-only grouping**: no products are merged, edited, or written
to the database. It only changes how the existing product list is rendered.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Approach | Display-group (keep products separate); no data merge |
| Actions | Each stock entry keeps its own Re-stock / history / edit / delete |
| Grouping key | Trimmed, case-insensitive product name |
| When to group | Only when 2+ products share a name; a single product renders unchanged |
| Header total | Sum quantities when all entries share the same unit; otherwise show "N stock entries" |
| Scope | One file: `src/pages/Inventory.tsx` (+ a small tested helper) |

## 3. Behaviour

- Grouping is applied to the already-filtered list (`filteredProducts`), so
  search and the injection filter still work; a group contains only products
  that passed the filter.
- Group order follows first-seen order in `filteredProducts`.
- **Single-product group:** render the current card unchanged (no visual
  change, no group chrome).
- **Multi-product group:** render one card with:
  - a **header** showing the item name and the total (summed quantity + shared
    unit when all entries share a unit, else `"<n> stock entries"`);
  - **one entry per product**, separated by dividers, each showing what a card
    shows today except the name: qty · unit · price, cost, "Stocked: \<date\> ·
    \<time\>", the profit-per-unit bar, and its own action row (Re-stock,
    history clock, edit, delete). Inline edit and restock still work per entry.

## 4. Grouping helper

`src/lib/inventoryGroups.ts`

- `export interface ProductGroup { key: string; name: string; products: Product[] }`
- `export function groupByName(products: Product[]): ProductGroup[]` — groups by
  `name.trim().toLowerCase()`, preserving first-seen order; `name` is the first
  product's original-cased name.
- `export function groupTotalLabel(products: Product[]): string` — when every
  product shares the same `unit`, returns `"<sumQty> <unit>"`; otherwise
  `"<n> stock entries"`.

## 5. Implementation (`Inventory.tsx`)

- Extract the current per-product card markup (lines rendering one product,
  including inline edit/restock modes and the action row) into a local function
  `renderProductCard(product, opts?: { grouped?: boolean })`.
  - When `opts.grouped` is true: **omit the product name line** (the group
    header shows it) and **drop the outer card border/background** (the group
    wrapper supplies it), so entries read as rows within the group card.
  - All existing per-product state and handlers (edit, restock, delete, history,
    injection tag) continue to key off `product.id` unchanged.
- Replace `filteredProducts.map(...)` with:
  - `groupByName(filteredProducts).map((group) => ...)`.
  - If `group.products.length === 1`: `renderProductCard(group.products[0])`
    (unchanged card).
  - Else: a group `<div>` card containing the header (`group.name` +
    `groupTotalLabel(group.products)`) and `group.products.map((p, i) =>`
    `renderProductCard(p, { grouped: true })` with a divider between entries.
- No changes to add/edit/restock/delete logic, the store, or any data.

## 6. Testing

- Unit-test `groupByName` (groups duplicates, preserves order, single stays
  single) and `groupTotalLabel` (sums when units match, "N stock entries"
  otherwise).
- Manual: a stock list with two same-named products shows one card with two
  dated entries, each with working Re-stock/edit/delete; a unique product is
  unchanged; search/filter still work.

## 7. Pros / Cons

**Pros**
- Matches the request; removes the confusing duplicate cards.
- Display-only → zero data risk, reversible.
- Per-entry actions preserved; extracting the card renderer tidies a large file.

**Cons / risks**
- The Inventory card JSX is large; extracting the entry renderer is a real
  refactor that must preserve all inline edit/restock behaviour.
- Grouped cards grow taller with many entries (expected and acceptable).

## 8. Out of scope

- Merging/deduping products in the database.
- Preventing future duplicate products at add/import time.
- Grouping by anything other than name (e.g. barcode).
