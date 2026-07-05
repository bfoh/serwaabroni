# Bulk Stock Intake — Design Spec

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan

## 1. Summary

Let a user load many products at once instead of adding them one by one, two ways:

1. **Template** — download a CSV, fill it in a spreadsheet, upload it back.
2. **Photo** — take/upload a photo of a stock list (typed or handwritten, in a
   table) and have Claude vision extract the rows.

Both paths converge on the **same editable review table**. The user corrects
values, sees which rows are new products vs restocks of existing ones, then
confirms. On confirm the app saves each row through the existing store
functions (`addProduct` / `receiveStock`), so all current validation, FIFO
costing, and sync behaviour is reused.

By default a bulk intake is treated as **opening stock** (recording inventory
already owned) — it sets quantities and prices but does **not** deduct cash or
create supplier debt. A toggle lets the user instead mark the whole batch as a
**purchase** (paid from cash/bank, or on supplier credit).

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Cash impact | Opening stock by default (no cash/debt); optional "purchase" mode (cash/bank or supplier credit) |
| Template format | CSV (download, fill, upload); no heavy dependency |
| CSV parsing | Small hand-rolled RFC-4180-subset parser (handles quoted commas), TDD'd — no new dependency |
| Photo OCR | Claude vision via a new Supabase edge function, reusing `ANTHROPIC_API_KEY` |
| Review step | Always show an editable review table before saving |
| Pack goods | When a row has Units Per Pack ≥ 2 (+ a Pack Unit), its Quantity/Cost/Selling are read PER PACK and converted to base on save (mirrors the single Add-Product form). Rows without pack info are per-piece. |
| Scope | One spec, two phases: Phase 1 CSV, Phase 2 photo |

## 3. Architecture

```
CSV file ─┐
          ├─→ parse ──→ rows ──→ [ Review table: edit / match / drop ] ──→ Confirm ──→ bulk save
Photo ────┘   (vision edge fn)        (new vs restock, validation)              (opening | purchase)
```

- **Entry:** a "Bulk add" button on Inventory opens `BulkAddSheet` with two tabs
  (Template, Photo).
- **Rows:** each parsed/extracted row is normalized and validated by
  `rows.ts`, and matched against existing products (reuse the agent's
  `matchProduct`) to mark it **New** or **Restock**.
- **Review:** `BulkReviewTable` renders the rows for editing; the Import button
  is disabled while any row is invalid.
- **Save:** confirm loops the rows, calling `addProduct` (new) or a
  quantity bump + `receiveStock` (restock), honoring the cash-mode toggle.

## 4. CSV template + parser

### Template (`src/lib/bulkImport/template.ts`)
Downloads `serwaabroni-stock-template.csv` containing a header row plus one
example data row:

Headers (in order):
`Name, Quantity, Unit, Cost Price, Selling Price, Category, Pack Unit, Units Per Pack, Low Stock Threshold`

- Required per row: `Name`, `Quantity`, `Cost Price`, `Selling Price`.
- Optional: `Unit` (default `piece`), `Category` (default the app's first
  category), `Pack Unit` + `Units Per Pack` (multi-unit goods), `Low Stock
  Threshold` (default `max(3, floor(qty*0.2))`).
- Reuse `download()` from `src/lib/export.ts` (BOM + text/csv) — do not
  re-implement the download helper.

### Parser (`src/lib/bulkImport/csv.ts`)
- `parseCSV(text: string): string[][]` — RFC-4180 subset: comma-separated,
  `"`-quoted fields, `""` escaped quotes inside quotes, CR/LF and CRLF line
  endings, trims a leading BOM, skips fully-blank lines.
- `toCSVRow(cells: string[]): string` — quote a cell when it contains a comma,
  quote, or newline.
- Must correctly parse a quoted field containing a comma (real data includes
  names like `"Pomo, Gino tomato mix 200g"`).

## 5. Photo → Claude vision (Phase 2)

### Edge function (`supabase/functions/serwaa-stock-vision/index.ts`)
- Same shape/auth as `serwaa-agent`: validate `body.userJwt` via GoTrue (401
  otherwise); read `ANTHROPIC_API_KEY` from `Deno.env`; wrap the handler in
  try/catch returning CORS-safe JSON (mirror `serwaa-agent`).
- Request: `{ userJwt: string; imageBase64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }`.
- Calls Claude `claude-haiku-4-5-20251001` with an image block + a strict
  instruction: extract the stock list as a JSON array of
  `{ name, quantity, unit, cost_price, selling_price }`; amounts are numbers;
  omit unknown fields; **return JSON only**.
- Parses the model's text as JSON (tolerant: strip any ```` ```json ```` fences)
  and responds `{ rows: RawRow[] }` where
  `RawRow = { name?: string; quantity?: number; unit?: string; cost_price?: number; selling_price?: number }`.
- On upstream/parse error returns a CORS-safe error; the client shows a
  "couldn't read the photo, try again or use the template" message.
- Register the function in `supabase/config.toml` with `verify_jwt = false`
  (same reason as the other functions — the app validates the user token in the
  body).

### Client (`src/lib/bulkImport/vision.ts`)
- `extractRowsFromImage(file: File): Promise<RawRow[]>` — resize/compress the
  image on a canvas to a max dimension (e.g. 1600px) and JPEG quality ~0.7 to
  bound tokens/cost, base64-encode it, POST to the edge function using the same
  anon-key-as-Bearer + `userJwt`-in-body pattern as `src/services/notify.ts`.

## 6. Review table (`src/components/inventory/BulkReviewTable.tsx`)

- Props: `rows: DraftRow[]`, `onChange(rows)`, `onImport()`, `importing`,
  `mode` (opening | purchase) and its setter, plus purchase sub-fields.
- Columns: Name, Qty, Unit, Cost, Sell, Category, Status, delete.
- **Status** per row (from `rows.ts`): `new`, `restock` (matched existing
  product — shows the matched name), or `invalid` (missing/nonpositive cost,
  sell, or qty) with the offending cells highlighted.
- Unit and Category use the same option lists the single Add-Product form uses.
- Footer: totals (N new, M restock), and an **Import** button disabled while any
  row is `invalid` or the list is empty.
- Cash-mode control at the top: **Opening stock** (default) vs **Purchase**;
  Purchase reveals account (cash/bank) or a supplier-credit toggle with supplier
  name (mirrors the single Add-Product form's fields).

### Row model + validation (`src/lib/bulkImport/rows.ts`)
- `interface DraftRow { name: string; quantity: number; unit: string; costPrice: number; sellPrice: number; category: string; packUnit: string | null; unitsPerPack: number; lowStockThreshold: number | null }`
- `normalizeRow(raw, defaults): DraftRow` — coerce types, apply defaults
  (unit `piece`, category default, `units_per_pack` 1).
- `rowStatus(row, products): { status: 'new' | 'restock' | 'invalid'; matchId: string | null; errors: string[] }`
  — invalid when name empty or cost/sell/qty not a positive number; restock when
  `matchProduct(row.name, products)` yields a unique match; else new.

## 6a. Pack goods (big vs small quantities)

The app stores products base-canonical: `quantity`, `cost_price`, `selling_price`
are all in the smallest (base) unit, with `pack_unit` + `units_per_pack`
describing the bigger unit. The single Add-Product form lets the user enter
quantity and prices in the **pack** unit and converts to base
(`baseQty = qty × units_per_pack`, `baseCost = cost ÷ units_per_pack`,
`baseSell = sell ÷ units_per_pack`, `Inventory.tsx:143-147`).

Bulk import mirrors this exactly:

- A row is **packed** when `Units Per Pack ≥ 2` and a `Pack Unit` is present. Its
  `Quantity`, `Cost Price`, `Selling Price` are then interpreted **per pack** and
  converted to base on save (round money to 2 dp). `units_per_pack`/`pack_unit`
  are stored so the product sells per base unit.
- A row without pack info is per-piece (factor 1, no conversion).
- The **review table shows the conversion** for packed rows (e.g.
  "5 box × 40 = 200 sachet · GH₵ 2.50/sachet") so the user sees base values
  before importing.
- Restock of an existing packed product adds the **base** quantity and uses the
  **base** unit cost.

`rows.ts` exposes `toBase(row)` returning the base `{ quantity, costPrice,
sellPrice, unitsPerPack, packUnit }`; `save.ts` and the review display use it.

## 7. Bulk save

On Import, loop the rows sequentially with a progress indicator:

- **New row** → `addProduct(product, injectionId, opts)`.
- **Restock row** → set `quantity = current + row.quantity` via `updateProduct`,
  then `receiveStock({ productId, qty, unitCost, ...opts })` — mirrors the
  existing manual restock (`Inventory.handleSaveRestock`).
- **Cash mode:**
  - **Opening stock** → `opts = { opening: true }`: batch created, but **no cash
    movement and no supplier debt**.
  - **Purchase, paid** → `opts = { account }` (cash/bank) → cash outflow posted.
  - **Purchase, supplier credit** → `opts = { unpaid: true }` and create one
    aggregate `owing` debt to the supplier for the batch's total cost (mirror
    the single Add-Product supplier-credit path).
- Collect per-row outcomes; show a summary toast/line: "Added X, restocked Y,
  Z failed" and keep any failed rows in the table for retry.

### The one store change
- Extend `addProduct` opts and `receiveStock` params with `opening?: boolean`.
- In `receiveStock`, skip the cash `postMovement` when opening: gate becomes
  `if (!params.unpaid && !params.opening && batch.total_cost > 0)`.
- `addProduct` passes `opts.opening` straight through to `receiveStock`.
- No other store changes; new/restock/purchase paths reuse existing code.

## 8. Cost & security

- `ANTHROPIC_API_KEY` stays a Supabase secret; the vision edge function is
  JWT-gated (no open proxy); no key in the SPA bundle.
- Image compressed client-side before upload; Haiku model; one call per photo →
  low, bounded cost.

## 9. Phasing

- **Phase 1:** CSV template + parser, row model/validation, review table, bulk
  save with opening/purchase, the `opening` store flag, Inventory entry button.
- **Phase 2:** vision edge function + client + the Photo tab.

## 10. Pros / Cons

**Pros**
- Onboarding/stock-take in minutes instead of one-by-one entry.
- Books stay correct: opening stock never drains cash; genuine purchases do.
- Reuses existing store, FIFO, product matching, and edge-function patterns.
- The review step catches OCR/typo errors before anything is written.

**Cons / risks**
- Handwriting OCR is imperfect → mitigated by the mandatory review table.
- Large lists = many sequential writes → progress bar now; batch insert is a
  possible later optimization.
- Opening stock must not post cash → handled by the `opening` flag and covered
  by tests.

## 11. Out of scope

- Editing/deleting existing products in bulk (only intake).
- Barcode/QR bulk assignment.
- Multi-image stitching for very long lists (one photo per import in Phase 2).
- A hosted spreadsheet editor in-app (users fill the CSV in their own tool).
