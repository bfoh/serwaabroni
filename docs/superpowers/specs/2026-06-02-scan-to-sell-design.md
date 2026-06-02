# Scan-to-Sell (POS Barcode/QR in the Sales Flow) — Design Spec

**Date:** 2026-06-02
**Status:** Approved

## Problem

Sales are built by tapping products in the New Sale grid (`AddSaleSheet`).
Scanning today only exists for stock-in (delivery) via `BarcodeScanner`. The user
wants supermarket-style checkout: scan a product's barcode/QR to add it to the
sale. The decode camera (native `BarcodeDetector` + lazy ZBar fallback) already
exists but is embedded in the 1100-line delivery `BarcodeScanner.tsx`.

## Goals

- In the New Sale flow, scan a barcode/QR to add the matching product to the cart.
- Continuous POS mode: camera stays open, each scan adds to cart, repeat scan of
  the same item increments quantity (capped at stock), with quick feedback; a
  Done button returns to the cart for checkout.
- Unknown code (no matching product) → toast "Not in inventory", keep scanning.
- Reuse one decode core for both scanners (no duplicated camera loop).
- Preserve all existing delivery-scanner behavior.

## Non-Goals

- No add-product / stock-in from the sale flow (unknown codes are skipped).
- No change to the sale write path, stock decrement, receipt, or grouping.
- No new scanning dependency (reuse existing `BarcodeDetector` + `@undecaf/zbar-wasm`).

## Architecture

### Unit 1 — `src/lib/scanner.ts` (pure utilities, no React)

Move these out of `BarcodeScanner.tsx` into a shared module and re-import them
there:

- `normalizeBarcode(code: string | null | undefined): string` — existing
  normalization (handles EAN/UPC leading-zero variants).
- `NATIVE_FORMATS: string[]` — the `BarcodeDetector` format list.
- `getBarcodeDetectorCtor(): BarcodeDetectorCtor | null` and its `NativeBarcodeDetector`/
  `BarcodeDetectorCtor` types.
- `loadZbar()` — the memoized dynamic import of `@undecaf/zbar-wasm`.

This is the single source for "how we decode a frame and match a code".

### Unit 2 — `src/hooks/useScanCamera.ts` (shared camera + decode loop)

```ts
interface UseScanCameraOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  active: boolean                 // start when true, fully stop when false
  paused?: boolean                // hold decoding without tearing down the camera
  onResult: (code: string) => void
}
interface UseScanCameraResult {
  stream: MediaStream | null      // exposed so callers can drive torch
  error: string | null           // permission / camera errors
}
function useScanCamera(opts: UseScanCameraOptions): UseScanCameraResult
```

Responsibilities (lifted verbatim from the current delivery loop):
- `getUserMedia({ video: { facingMode: environment, 1920x1080, continuous focus }})`,
  attach to `videoRef`, `playsinline`, autoplay; apply continuous-focus
  constraint best-effort.
- Pick decoder: `getBarcodeDetectorCtor()` → native; else `await loadZbar()` and
  use ZBar (`scanImageData` on a downscaled canvas frame).
- RAF decode loop; on a non-empty decode, call `onResult(code)`; skip decoding
  while `paused`.
- Full teardown on `active === false` or unmount (stop tracks, cancel RAF, null
  refs).

The hook owns the refs currently inline in `BarcodeScanner` (stream, detector,
canvas, decodeMode, raf). It does **not** own product matching, UI, torch, item
sheets, or upload — those stay with each caller.

### Unit 3 — `src/components/SaleScanner.tsx` (POS overlay)

Props:
```ts
interface SaleScannerProps {
  isOpen: boolean
  onClose: () => void
  onProductScanned: (product: Product) => void
}
```

Behavior:
- Renders a full-screen camera view (its own `<video>` + reticle), `useScanCamera({
  videoRef, active: isOpen, onResult: handleCode })`. Uses the returned `stream`
  for an optional torch toggle (reuse the existing torch constraint pattern).
- `handleCode(code)`:
  - Cooldown guard: ignore if the same normalized code fired within ~1200ms
    (prevents one in-frame barcode from spamming adds; a deliberate rescan after
    the cooldown adds another unit).
  - `const target = normalizeBarcode(code)`; find in `state.products` where
    `normalizeBarcode(p.barcode) === target || normalizeBarcode(p.qr_code) === target`.
  - **Found:** `onProductScanned(product)`; green flash overlay + `navigator.vibrate(60)`
    (best-effort) + toast `Added <name>`; keep scanning.
  - **Not found:** toast `Not in inventory`; keep scanning.
- Header shows a running tally provided by the parent (items count + running
  total) and a **Done** button → `onClose()`.
- On permission error (`error` from the hook), show the same permission message
  pattern the delivery scanner uses.

### Unit 4 — `AddSaleSheet` wiring

- Add a **SCAN** icon button (lucide `ScanLine`) in the grid-view header, beside
  the search input.
- State: `const [showScan, setShowScan] = useState(false)`.
- Render `<SaleScanner isOpen={showScan} onClose={() => setShowScan(false)}
  onProductScanned={(p) => addToCart(p.id)} />`.
- `addToCart` is unchanged (already adds/increments, capped at stock). After
  Done, the user is on the cart view (set `view='cart'` when the first item is
  added — `addToCart` already does `setView('cart')`).
- The running tally shown in `SaleScanner` header is derived from the existing
  cart `total`/`itemCount` memos (pass as props, or pass the cart array).

### Unit 5 — Delivery `BarcodeScanner` refactor (preserve behavior)

- Import `normalizeBarcode`, `NATIVE_FORMATS`, `getBarcodeDetectorCtor`,
  `loadZbar` from `src/lib/scanner.ts` (delete the local copies).
- Replace the inline `startCameraScanner` + `decodeFromVideo` + `runDetectLoop`
  live-camera path with `useScanCamera({ videoRef, active: <camera-mode on>,
  paused: showItemSheet, onResult: <existing decoded-code handler> })`.
- Keep everything else: the item sheet, manual/NEW-BARCODE entry, photo upload
  (html5-qrcode), product DB lookup, torch (now driven by the hook's returned
  `stream`), pause/resume semantics (via `paused`).
- Net: identical delivery UX; the camera/decoder logic now lives in the hook.

## Data Flow

```
SaleScanner: frame --useScanCamera--> code
  --normalizeBarcode + state.products match-->
    found  -> onProductScanned(product) -> AddSaleSheet.addToCart(id) -> cart
    none   -> toast, continue
AddSaleSheet cart --(unchanged)--> addSaleBatch -> sales rows (grouped) + stock
```

No change below the cart: scanned items are ordinary cart items.

## Error Handling

- Camera/permission errors surface via `useScanCamera().error`; `SaleScanner`
  shows the permission message and a Close action.
- Unknown barcode: non-blocking toast, scanning continues.
- Product with no `barcode`/`qr_code` simply never matches (cannot be sold by
  scan; still sellable by tap).
- Decode exceptions inside the loop are swallowed (transient) — same as today.

## Testing / Verification

No unit-test runner; verification = `npm run build` + `npm run lint` + manual:

- **Scan-to-sell happy path:** open New Sale → SCAN → scan a stocked product with
  a barcode → green flash + "Added", tally increments; scan a second product →
  added; rescan the first → qty becomes 2; Done → cart shows both with correct
  quantities; CONFIRM → sale records, stock decrements.
- **Stock cap:** scanning beyond available stock does not exceed it (addToCart
  cap).
- **Unknown code:** scan a barcode not in inventory → "Not in inventory", no cart
  change, scanning continues.
- **QR:** a product whose `qr_code` matches also adds.
- **Delivery regression (Unit 5):** the delivery scanner still scans live, opens
  the item sheet, torch works, manual entry works, photo upload works, DB lookup
  works — unchanged.
- **Build:** `npm run build` succeeds; the ZBar chunk still loads lazily (only on
  the ZBar path), `html5-qrcode` still only on upload.

## Files

- Create: `src/lib/scanner.ts`, `src/hooks/useScanCamera.ts`,
  `src/components/SaleScanner.tsx`.
- Modify: `src/components/AddSaleSheet.tsx` (scan button + SaleScanner),
  `src/components/BarcodeScanner.tsx` (use shared utils + hook).

## No-Break Guarantees

- Sale write path, stock decrement, receipt, and grouping are untouched —
  scanned items are normal cart entries.
- Delivery scanner behavior preserved (Unit 5 is a mechanical extraction).
- ZBar/html5-qrcode remain lazy-loaded; no new dependency.
