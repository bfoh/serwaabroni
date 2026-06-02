# Lazy-Load Scanner Libraries — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Component:** `src/components/BarcodeScanner.tsx` (single file)

## Problem

The barcode scanner statically imports two heavy runtime dependencies at the top
of `BarcodeScanner.tsx`:

```ts
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { scanImageData, getInstance } from '@undecaf/zbar-wasm'
```

Because they are static imports, Vite bundles them into the **main app chunk**
(the build warns the chunk exceeds 500KB; the ZBar WASM alone is ~238KB). Every
user downloads them on first app load even though scanning is occasional. On
slow Ghanaian mobile networks this delays cold start for no benefit.

The native `BarcodeDetector` fast-path already exists (Android uses
`BarcodeDetector`; iOS falls back to ZBar WASM; RAF decode loop; autofocus; WASM
warm-up). This work does **not** change scanning behavior — only *when* the
libraries load.

## Goals

- Keep `html5-qrcode` and `@undecaf/zbar-wasm` out of the main bundle.
- Load ZBar only when the live scanner falls back to it (iOS); never on Android,
  where native `BarcodeDetector` handles decoding.
- Load `html5-qrcode` only when the user scans from a photo (file upload).
- No change to scanning behavior, formats, or UI.

## Non-Goals

- No change to the decode algorithm, format list, or scanner UI.
- No removal of `html5-qrcode` (still needed for photo-upload scanning).
- No new dependency.

## Design

### 1. Type-only import for `Html5Qrcode`

`scannerRef` is typed `useRef<Html5Qrcode | null>`. Keep the type, drop the
runtime import:

```ts
import type { Html5Qrcode } from 'html5-qrcode'
```

Remove the value imports of `Html5Qrcode`, `Html5QrcodeSupportedFormats`,
`scanImageData`, and `getInstance`.

### 2. Memoized module-level dynamic loaders

Add near the top of the file (module scope, shared across mounts):

```ts
let zbarMod: typeof import('@undecaf/zbar-wasm') | null = null
const loadZbar = async () => (zbarMod ??= await import('@undecaf/zbar-wasm'))

let html5Mod: typeof import('html5-qrcode') | null = null
const loadHtml5 = async () => (html5Mod ??= await import('html5-qrcode'))
```

Vite code-splits each dynamic `import()` into its own chunk, removed from the
main bundle. Memoization means repeat scanner opens / uploads reuse the loaded
module.

### 3. Move `SUPPORTED_FORMATS` into the upload path

The top-level `const SUPPORTED_FORMATS = [Html5QrcodeSupportedFormats.QR_CODE, …]`
references the enum, which would force a static import. Delete that top-level
const. Rebuild the format list **inside** `handleFileUpload`, after the module is
loaded, from the loaded module's enum.

`NATIVE_FORMATS` (plain strings, no dependency) is unchanged.

### 4. Call-site wiring

**`startCameraScanner`** — currently warms ZBar unconditionally via
`getInstance()` and picks the decoder later. Reorder so ZBar loads only when it
will be used:
- Pick the decoder first (`getBarcodeDetectorCtor()` → native vs zbar) — this
  logic is unchanged.
- If mode is **native** (Android): do not touch ZBar. The 238KB WASM is never
  fetched on Android.
- If mode is **zbar** (iOS/unsupported): `await loadZbar()` then warm
  `zbarMod.getInstance()` before starting the RAF loop, preserving the
  instant-first-scan behavior.

**`decodeFromVideo`** — the ZBar branch calls `scanImageData(imageData)`. Change
to `zbarMod!.scanImageData(imageData)` (non-null: the loop only runs in zbar mode
after `loadZbar()` completed in `startCameraScanner`).

**`handleFileUpload`** — before `new Html5Qrcode(...)`:

```ts
const { Html5Qrcode, Html5QrcodeSupportedFormats } = await loadHtml5()
const formats = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.AZTEC,
]
const scanner = new Html5Qrcode('upload-scanner-hidden', {
  verbose: false,
  useBarCodeDetectorIfSupported: true,
  formatsToSupport: formats,
  experimentalFeatures: { useBarCodeDetectorIfSupported: true },
})
```

The `'fallback'` live engine (the only other `Html5Qrcode` consumer, used by the
torch branch at `engineRef.current === 'fallback'`) is not currently constructed
anywhere in the live path after the native/ZBar rewrite; it reads `scannerRef`
which stays null on the live path. No behavior change — leave that branch as-is
(it is effectively dormant); it simply will not run because `scannerRef` is
null. (Removing the dormant fallback engine is out of scope for this spec.)

## Affected File

- `src/components/BarcodeScanner.tsx` — imports, two module-level loaders, delete
  top-level `SUPPORTED_FORMATS`, reorder ZBar load in `startCameraScanner`,
  `zbarMod!.scanImageData` in `decodeFromVideo`, dynamic `loadHtml5()` in
  `handleFileUpload`.

## No-Break Guarantees

- Scanning behavior, formats, autofocus, and warm-up timing are preserved.
- Android: native `BarcodeDetector` path unchanged, now also skips the ZBar
  download entirely.
- iOS: ZBar loads on scanner open (parallel with camera start, as before) — same
  perceived speed.
- Photo upload: `html5-qrcode` loads on first upload; memoized after.
- Memoized loaders prevent duplicate imports across repeated opens.

## Testing / Verification

No unit-test runner; verification = `npm run build` + `npm run lint` + manual:

- **Build:** `dist/assets` shows separate chunks for `zbar`/`html5-qrcode`
  (dynamic-import chunks), and the main `index-*.js` chunk is smaller than before
  (was ~1.5MB).
- **Lint:** no new errors in `BarcodeScanner.tsx`.
- **Live scan iOS (or non-BarcodeDetector browser):** open scanner, scan an
  EAN/QR — decodes as before; first scan still instant (warm-up preserved).
- **Live scan Android (BarcodeDetector):** scanning works; Network tab shows the
  ZBar WASM chunk is **not** fetched.
- **Photo upload:** upload a barcode image → decodes; html5-qrcode chunk fetched
  on first upload only.
- **Repeat:** reopening the scanner or uploading again does not re-fetch
  (memoized).
