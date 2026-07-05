# Bulk Sales Entry — Design Spec

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## 1. Summary

Let a user record many past sales at once — sales they wrote in a book or on
paper during a busy day and want to enter later. Two ways, mirroring bulk stock
intake:

1. **Template** — download a CSV, fill it from the sales book, upload it back.
2. **Photo** — photograph the handwritten sales log; Claude vision (Sonnet)
   extracts the rows.

Both converge on one **editable review table**. Each row must be matched to an
existing product, carries its own **date** (defaults to today), and its own
**payment method**. On confirm, sales are written through the existing sale path
(`addSaleBatch` → FIFO + stock decrement), cash/momo/bank sales post to the cash
ledger on the sale's date, and credit sales create a "they owe you" debt.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Intake | CSV template + photo (handwritten log), same as bulk stock; always review before saving |
| Sale date | Per-row Date column; blank = today. Becomes the sale's `created_at`. |
| Unmatched product | Fuzzy-match names; unmatched rows flagged with a product picker; import blocked until every row matches a product and is valid. No quick-create. |
| Payment | Per-row: cash / momo / bank / credit. Cash/momo/bank post to the ledger on the sale's date; credit requires a customer name and creates a linked `owed` debt. |
| Unit price | Defaults to the matched product's selling price; editable per row (discounts). |
| Pack goods | If a row's Unit equals the matched product's pack unit (multi-unit product), quantity is in packs → converts to base (`qty × units_per_pack`); an entered per-pack price divides to base. Pack size comes from the matched product. |
| Stock underflow | Recording a qty above current stock is allowed (the sale really happened); the review warns. `recordSaleBatch` already floors `products.quantity` at 0. |
| Vision function | New `serwaa-sales-vision` edge function (single-purpose), reusing `ANTHROPIC_API_KEY`, Sonnet model. |
| Scope | One spec, two phases: Phase 1 CSV, Phase 2 photo. |

## 3. Architecture

```
CSV file ─┐
          ├─→ parse ──→ rows ──→ [ Review: product match · qty/price · payment · customer · date · pack ] ──→ Confirm ──→ saveBulkSales
Photo ────┘   (serwaa-sales-vision)        (validation, warnings)                                                    (addSaleBatch + ledger + debts)
```

- **Entry:** a "Bulk add" button in the Sales History header opens
  `BulkSalesSheet` (Template / Photo tabs).
- **Rows:** each parsed/extracted row is normalized, fuzzy-matched to a product
  (`matchProduct`), and validated by `rows.ts`.
- **Review:** `BulkSalesReviewTable` renders rows for editing, with a product
  picker for unmatched rows; the Import button is disabled while any row is
  unmatched or invalid.
- **Save:** `saveBulkSales` builds Sale rows, calls `addSaleBatch` once, posts
  ledger movements for cash/momo/bank sales, and creates debts for credit sales.

## 4. CSV template + parser

- Reuse `parseCSV` / `toCSVRow` from `@/lib/bulkImport/csv` (generic; do not
  duplicate). Reuse `download` from `@/lib/export`.
- **Template** (`src/lib/bulkSales/template.ts`) downloads
  `serwaabroni-sales-template.csv` with headers + two examples:

  Headers: `Product, Quantity, Unit, Unit Price, Payment, Customer, Date`
  - Required per row: `Product`, `Quantity`.
  - `Unit` optional (informational / pack detection). `Unit Price` optional →
    defaults to the matched product's selling price. `Payment` optional →
    defaults `cash` (one of cash/momo/bank/credit). `Customer` only for credit.
    `Date` optional (ISO `YYYY-MM-DD` or blank = today).

## 5. Row model, matching, validation (`src/lib/bulkSales/rows.ts`)

- `interface SaleRawRow { product?: string; quantity?: number; unit?: string; unit_price?: number; payment?: string; customer?: string; date?: string }`
- `interface SaleDraftRow { id: string; product: string; productId: string | null; quantity: number; unit: string; unitPrice: number | null; payment: 'cash' | 'momo' | 'bank' | 'credit'; customer: string; date: string }`
  - `date` is an ISO datetime string (blank input → today at import time).
  - `unitPrice` null means "use the product's selling price".
- `rowsFromMatrix(matrix): SaleRawRow[]` — maps a parsed CSV matrix (headers
  matched case-insensitively).
- `normalizeSaleRow(raw): SaleDraftRow` — coerce/default (`payment` `cash`,
  `unit` `piece`, `date` → today ISO if blank/invalid, generate `id`,
  `productId` null).
- `matchSaleRow(row, products): SaleDraftRow` — set `productId` via
  `matchProduct(row.product, products)` when unique (used on load and after edit).
- `PAYMENTS = ['cash', 'momo', 'bank', 'credit']`.
- `isPackedSale(row, product): boolean` — true when `product.units_per_pack >= 2`
  and `row.unit` equals `product.pack_unit` (case-insensitive).
- `toBaseSale(row, product): { quantity: number; unitPrice: number; saleUnit: string | null; saleUnitQty: number | null }`
  — resolves base quantity and base unit price:
  - factor = packed ? `product.units_per_pack` : 1.
  - `quantity = row.quantity × factor`.
  - entered price basis: `row.unitPrice ?? (packed ? product.selling_price × factor : product.selling_price)`; base `unitPrice = round2(enteredPrice / factor)`.
  - `saleUnit = packed ? product.pack_unit : null`, `saleUnitQty = packed ? row.quantity : null`.
- `saleRowStatus(row, products): { status: 'ready' | 'unmatched' | 'invalid'; errors: string[]; warnings: string[] }`
  - `unmatched` when `productId` is null (or no product resolves).
  - `invalid` when `quantity <= 0`, or `payment === 'credit'` with empty
    `customer`, or `unitPrice` present and `<= 0`.
  - `warnings` includes `'stock'` when base quantity exceeds the matched
    product's current `quantity` (still importable).
  - `ready` otherwise.

## 6. Save orchestrator (`src/lib/bulkSales/save.ts`)

- `interface BulkSalesApi { addSaleBatch: (sales: Record<string, unknown>[], items: { productId: string; qty: number }[]) => Promise<void>; addDebt: (debt: Record<string, unknown>) => Promise<void>; postMovement: (mv: { account: 'cash' | 'bank'; direction: 'in' | 'out'; amount: number; category: string; ref_table: string; ref_id: string; note: string | null; created_at: string }) => Promise<void> }`
- `interface BulkSalesResult { recorded: number; debts: number; failed: number; failures: { product: string; error: string }[] }`
- `saveBulkSales(rows, products, api, onProgress?): Promise<BulkSalesResult>`:
  - Skip rows whose `saleRowStatus` is `unmatched` or `invalid`.
  - For each valid row: resolve the product, compute base values via
    `toBaseSale`, build a Sale object:
    `{ id: uid(), product_id, product_name, quantity: base.quantity, unit_price: base.unitPrice, total: base.unitPrice × base.quantity, profit: (base.unitPrice − product.cost_price) × base.quantity, customer_name: payment === 'credit' ? customer : null, customer_phone: null, payment_method: payment, sale_group_id: <own uid>, sale_unit: base.saleUnit, sale_unit_qty: base.saleUnitQty, created_at: row.date }`
    and an item `{ productId, qty: base.quantity }`.
  - Call `addSaleBatch(sales, items)` **once** with all rows.
  - After it resolves, for each row compute `saleMovement(payment, total, 0)`
    (from `@/lib/cashPosting`): cash → `{cash, total}`, momo/bank → `{bank, total}`,
    credit → `null`. When non-null, `postMovement({ account, direction: 'in',
    amount, category: 'sale', ref_table: 'sales', ref_id: <sale_group_id>,
    note: customer || null, created_at: row.date })`.
  - For each credit row, `addDebt({ id: uid(), person_name: customer, phone: null,
    amount: total, amount_paid: 0, payments: [], description: '<n> item(s) on
    credit', type: 'owed', due_date: null, injection_id: null, sale_group_id,
    is_paid: false, paid_at: null, created_at: row.date })`.
  - Count outcomes; capture per-row failures without aborting.

**Ordering note:** `addSaleBatch` runs first (it inserts sales, decrements
stock, refreshes the dashboard); movements/debts are posted afterward and
reference each row's `sale_group_id`.

## 7. Photo → Claude vision (Phase 2)

- New edge function `supabase/functions/serwaa-sales-vision/index.ts`: same
  auth/secret/try-catch pattern as `serwaa-stock-vision`, Sonnet
  (`claude-sonnet-5`), handwriting-aware prompt tuned for a **sales log** —
  extract `{ product (string), quantity (number), unit (string), unit_price
  (number), payment (string), customer (string), date (string) }`, JSON only,
  one row per sale line. Register in `supabase/config.toml` with
  `verify_jwt = false`.
- Client `src/lib/bulkSales/vision.ts`: `normalizeSalesVisionRows(rows)` coerces
  arbitrary JSON to `SaleRawRow[]`; `extractSalesFromImage(file)` compresses the
  image (1568px, JPEG 0.9) and POSTs to the edge function (anon-key Bearer +
  `userJwt` in body), returning `SaleRawRow[]`.

## 8. Components

- `BulkSalesReviewTable` (`src/components/sales/BulkSalesReviewTable.tsx`): row
  grid with a **product `<select>`** (options = existing products) that sets
  `productId`; editable Qty, Unit, Unit Price; a Payment select
  (cash/momo/bank/credit); a Customer input shown for credit; a Date input; a
  Status pill (Ready / Match? / Fix) and a stock warning; delete. Footer: counts
  and an Import button disabled while any row is unmatched or invalid.
- `BulkSalesSheet` (`src/components/sales/BulkSalesSheet.tsx`): Template / Photo
  tabs (Phase 2 for Photo), wires parse/vision → `normalizeSaleRow` +
  `matchSaleRow` → review → `saveBulkSales` using store `addSaleBatch`,
  `addDebt`, and `postMovement` (from `@/services/cashApi`).
- `SalesHistory.tsx`: a "Bulk add" button in the header opens the sheet.

## 9. Cost & security

- `ANTHROPIC_API_KEY` stays a Supabase secret; the sales-vision function is
  JWT-gated; no key in the SPA bundle; image compressed client-side; Sonnet, one
  call per photo.

## 10. Phasing

- **Phase 1:** CSV template + parser reuse, row model/matching/validation, review
  table with product picker, `saveBulkSales`, Sales History entry button.
- **Phase 2:** `serwaa-sales-vision` edge function + client + Photo tab.

## 11. Pros / Cons

**Pros**
- Catch-up entry of a day's book in minutes.
- Correct per-sale dates → accurate daily reports and history.
- Reuses FIFO, cash ledger, and debt logic; product-match requirement keeps
  stock/profit honest.
- Review step guards OCR/typo errors before writing money.

**Cons / risks**
- Past sales exceeding current stock floor `products.quantity` at 0 and may
  overstate profit on the FIFO shortfall → the review **warns** per row; still
  allowed.
- Handwriting OCR imperfect → mitigated by the review table and product picker.
- Many sequential ledger/debt writes for large batches → progress feedback;
  batch optimization deferred.

## 12. Out of scope

- Editing/deleting existing sales in bulk.
- Partial-payment credit sales (deposit) in bulk (credit = full amount owed).
- Quick-creating a new product from within the sales flow.
- Multi-image stitching for very long logs (one photo per import in Phase 2).
